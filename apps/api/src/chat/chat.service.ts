import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConversationService } from '../conversation/conversation.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { CitationsService, Citation } from '../citations/citations.service';
import { PromptEngineService } from '../prompt-engine/prompt-engine.service';
import { ContextBuilderService } from '../context-builder/context-builder.service';
import { ConfigService } from '@nestjs/config';
import { MessageRole } from '@prisma/client';
import { Response } from 'express';

export interface SendChatDto {
  conversationId?: string;
  message: string;
  documentIds?: string[];
  mode: 'study' | 'quiz' | 'flashcard';
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly aiServiceUrl: string;

  constructor(
    private conversationService: ConversationService,
    private retrievalService: RetrievalService,
    private citationsService: CitationsService,
    private promptEngineService: PromptEngineService,
    private contextBuilderService: ContextBuilderService,
    private configService: ConfigService,
  ) {
    this.aiServiceUrl = this.configService.get<string>('NEXT_PUBLIC_AI_SERVICE_URL', 'http://localhost:8000');
  }

  async handleChatStream(
    dto: SendChatDto,
    userId: string,
    res: Response,
  ): Promise<void> {
    let conversationId = dto.conversationId;

    // 1. Create conversation if not provided
    if (!conversationId) {
      const title = dto.message.slice(0, 30) || 'New Study Session';
      const conv = await this.conversationService.createConversation(userId, title);
      conversationId = conv.id;
      // Send conversation ID to client as first event so they can associate subsequent messages
      res.write(`event: conversationId\ndata: ${conversationId}\n\n`);
    } else {
      // Validate conversation ownership
      await this.conversationService.findConversationById(conversationId, userId);
    }

    // 2. Save user message in PostgreSQL
    await this.conversationService.saveMessage(conversationId, MessageRole.USER, dto.message);

    // 3. Perform Vector Search & Reranking via Retrieval Service
    const retrievalResult = await this.retrievalService.retrieveContext(
      userId,
      dto.message,
      dto.documentIds,
    );

    // 4. Enrich citations with document titles
    const enrichedCitations = await this.citationsService.enrichCitations(retrievalResult.chunks);

    // Send citations event immediately
    res.write(`event: citation\ndata: ${JSON.stringify(enrichedCitations)}\n\n`);

    // 5. Fetch history and cached summaries from Context Builder
    const contextPackage = await this.contextBuilderService.buildContext(conversationId, userId);

    // 6. Build RAG system prompt via Prompt Engine
    const systemPrompt = this.promptEngineService.buildSystemPrompt(
      dto.mode,
      retrievalResult.context,
      contextPackage.summary,
    );

    // 7. Stream LLM Response from FastAPI
    await this.streamFromAiService(
      systemPrompt,
      dto.message,
      contextPackage.history,
      conversationId,
      enrichedCitations,
      res,
    );
  }

  async regenerateLastMessage(
    conversationId: string,
    userId: string,
    res: Response,
  ): Promise<void> {
    // 1. Retrieve conversation & messages
    const conversation = await this.conversationService.findConversationWithMessages(conversationId, userId);
    const messages = conversation.messages;

    if (messages.length === 0) {
      throw new InternalServerErrorException('No messages to regenerate');
    }

    // Identify last message
    const lastMsg = messages[messages.length - 1];
    let promptMessageText = '';
    let precedingMessages = [...messages];

    if (lastMsg.role === MessageRole.ASSISTANT) {
      // Delete last assistant message
      await this.conversationService.deleteMessage(lastMsg.id);
      precedingMessages.pop();

      const newLastMsg = precedingMessages[precedingMessages.length - 1];
      if (newLastMsg && newLastMsg.role === MessageRole.USER) {
        promptMessageText = newLastMsg.content;
      }
    } else if (lastMsg.role === MessageRole.USER) {
      promptMessageText = lastMsg.content;
    }

    if (!promptMessageText) {
      throw new InternalServerErrorException('No user query found to regenerate from');
    }

    // 2. Perform Retrieval
    const retrievalResult = await this.retrievalService.retrieveContext(
      userId,
      promptMessageText,
    );

    // 3. Enrich citations
    const enrichedCitations = await this.citationsService.enrichCitations(retrievalResult.chunks);
    res.write(`event: citation\ndata: ${JSON.stringify(enrichedCitations)}\n\n`);

    // 4. Build context history excluding the query itself
    // Fetch last N messages minus the prompt query message
    const contextPackage = await this.contextBuilderService.buildContext(conversationId, userId);
    const historyExcludingLastUser = contextPackage.history.slice(0, -1);

    // 5. Build prompt
    const systemPrompt = this.promptEngineService.buildSystemPrompt(
      'study', // Default to study mode for regeneration
      retrievalResult.context,
      contextPackage.summary,
    );

    // 6. Stream and Save
    await this.streamFromAiService(
      systemPrompt,
      promptMessageText,
      historyExcludingLastUser,
      conversationId,
      enrichedCitations,
      res,
    );
  }

  private async streamFromAiService(
    systemPrompt: string,
    message: string,
    history: Array<{ role: string; content: string }>,
    conversationId: string,
    citations: Citation[],
    res: Response,
  ): Promise<void> {
    try {
      const response = await fetch(`${this.aiServiceUrl}/ai/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemPrompt,
          message,
          history,
        }),
      });

      if (!response.ok || !response.body) {
        this.logger.error(`Failed to stream from AI service: ${response.statusText}`);
        res.write(`event: error\ndata: Failed to generate response\n\n`);
        res.end();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantResponse = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: token')) {
            // Forward event: token
            res.write(`${line}\n`);
          } else if (line.startsWith('data: ')) {
            // Track accumulated response text
            const dataContent = line.replace('data: ', '').trim();
            if (dataContent) {
              assistantResponse += dataContent;
            }
            res.write(`${line}\n`);
          } else if (line.startsWith('event: done')) {
            // Yield done event
            res.write(`${line}\n`);
          } else if (line.trim() === '') {
            res.write('\n');
          }
        }
      }

      // Process any remainder in the buffer
      if (buffer.trim()) {
        res.write(`${buffer}\n\n`);
      }

      // Save complete assistant message to Postgres
      if (assistantResponse) {
        await this.conversationService.saveMessage(
          conversationId,
          MessageRole.ASSISTANT,
          assistantResponse,
          citations,
        );
      }

      // End connection
      res.write(`event: done\ndata: {}\n\n`);
      res.end();

    } catch (err: any) {
      this.logger.error(`Error streaming from AI service: ${err.message}`);
      res.write(`event: error\ndata: Stream connection failure\n\n`);
      res.end();
    }
  }
}
