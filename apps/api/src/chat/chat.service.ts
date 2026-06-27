import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConversationService } from '../conversation/conversation.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { CitationsService, Citation } from '../citations/citations.service';
import { PromptEngineService } from '../prompt-engine/prompt-engine.service';
import { ContextBuilderService } from '../context-builder/context-builder.service';
import { ConfigService } from '@nestjs/config';
import { MessageRole } from '@prisma/client';
import { Response } from 'express';
import { CacheService } from '../common/services/cache.service';
import { MetricsService } from '../common/services/metrics.service';
import { MarketplaceService } from '../marketplace/marketplace.service';

export interface SendChatDto {
  conversationId?: string;
  message: string;
  documentIds?: string[];
  mode: 'study' | 'quiz' | 'flashcard';
  enabledPluginKeys?: string[];
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
    private cacheService: CacheService,
    private metricsService: MetricsService,
    private marketplaceService: MarketplaceService,
  ) {
    this.aiServiceUrl = this.configService.get<string>('NEXT_PUBLIC_AI_SERVICE_URL', 'http://localhost:8000');
  }

  async handleChatStream(
    dto: SendChatDto,
    userId: string,
    res: Response,
    tenantId?: string,
  ): Promise<void> {
    const startMs = Date.now();
    let conversationId = dto.conversationId;

    // ─── RAG Query Cache Check ──────────────────────────────────────────
    // Only cache on non-new conversations (we need a conversationId for SSE)
    if (conversationId) {
      const cacheKey = CacheService.ragQueryKey(userId, dto.message);
      const cached = await this.cacheService.get<string>(cacheKey);

      if (cached) {
        this.logger.log(`RAG cache HIT for key=${cacheKey}`);
        // Re-stream cached answer as synthetic SSE tokens
        const words = cached.split(' ');
        for (const word of words) {
          res.write(`event: token\ndata: ${word} \n\n`);
        }
        res.write(`event: done\ndata: {}\n\n`);
        res.end();

        // Record cache-hit metric (fire-and-forget)
        this.metricsService.recordUsage({
          userId, tenantId: tenantId ?? 'unknown',
          endpoint: 'chat.send',
          cacheHit: true,
          latencyMs: Date.now() - startMs,
          model: 'cached',
        });
        return;
      }
    }

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
    const systemPrompt = await this.promptEngineService.buildSystemPrompt(
      dto.mode,
      retrievalResult.context,
      contextPackage.summary,
    );

    // 7. Fetch installed plugins for the active organization
    let installedTools: any[] = [];
    if (tenantId) {
      installedTools = await this.marketplaceService.getInstalledPlugins(tenantId).catch(() => []);
    }

    // Filter by enabledPluginKeys if provided
    if (dto.enabledPluginKeys && dto.enabledPluginKeys.length > 0) {
      installedTools = installedTools.filter((t) => dto.enabledPluginKeys!.includes(t.key));
    }

    const geminiTools = installedTools.map((t) => ({
      name: t.key,
      description: t.description,
      parameters: t.inputSchema,
    }));

    // 8. Stream LLM Response supporting tool calling loops
    let loopCount = 0;
    const maxLoops = 5;
    const activeMessage = dto.message;
    const activeHistory = [...contextPackage.history];
    const activeCitations = [...enrichedCitations];
    let finalFullText = '';
    let finalTokenCount = 0;

    while (loopCount < maxLoops) {
      loopCount++;

      const streamResult = await this.streamFromAiService(
        systemPrompt,
        activeMessage,
        activeHistory,
        conversationId,
        activeCitations,
        res,
        userId,
        geminiTools,
      );

      if (streamResult.toolCall) {
        const { name: toolName, args: toolArgs } = streamResult.toolCall;
        res.write(`event: token\ndata: [Executing tool: ${toolName}...] \n\n`);

        let toolResult: any;
        try {
          const plugin = installedTools.find((t) => t.key === toolName);
          if (!plugin) {
            throw new Error(`Tool ${toolName} is not installed`);
          }

          toolResult = await this.marketplaceService.executeInstalledPlugin({
            organizationId: tenantId!,
            pluginId: plugin.id,
            userId,
            inputData: toolArgs,
            conversationId,
          });
        } catch (err: any) {
          toolResult = { error: err.message };
        }

        // Save tool call and response messages in DB
        await this.conversationService.saveMessage(
          conversationId,
          MessageRole.ASSISTANT,
          JSON.stringify({ type: 'tool_call', name: toolName, args: toolArgs }),
        );
        await this.conversationService.saveMessage(
          conversationId,
          MessageRole.USER,
          JSON.stringify({ type: 'tool_response', name: toolName, response: toolResult }),
        );

        // Append to active context history
        activeHistory.push({
          role: 'assistant',
          content: JSON.stringify({ type: 'tool_call', name: toolName, args: toolArgs }),
        });
        activeHistory.push({
          role: 'user',
          content: JSON.stringify({ type: 'tool_response', name: toolName, response: toolResult }),
        });

        continue;
      }

      finalFullText = streamResult.fullText;
      finalTokenCount = streamResult.tokenCount;
      break;
    }

    // 9. Write response to RAG cache (async, non-blocking)
    if (finalFullText && conversationId) {
      const cacheKey = CacheService.ragQueryKey(userId, dto.message);
      this.cacheService.setRagResponse(userId, cacheKey, finalFullText).catch(() => {});
    }

    // 10. Record usage metrics (fire-and-forget)
    this.metricsService.recordUsage({
      userId,
      tenantId: tenantId ?? 'unknown',
      endpoint: 'chat.send',
      tokensOut: finalTokenCount,
      latencyMs: Date.now() - startMs,
      cacheHit: false,
      model: 'gemini-1.5-flash',
    });
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
    const precedingMessages = [...messages];

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
    const systemPrompt = await this.promptEngineService.buildSystemPrompt(
      'study', // Default to study mode for regeneration
      retrievalResult.context,
      contextPackage.summary,
    );

    // 6. Fetch installed plugins for regeneration
    let installedTools: any[] = [];
    if (conversation.tenantId) {
      installedTools = await this.marketplaceService.getInstalledPlugins(conversation.tenantId).catch(() => []);
    }

    const geminiTools = installedTools.map((t) => ({
      name: t.key,
      description: t.description,
      parameters: t.inputSchema,
    }));

    // 7. Stream and Save supporting tool execution
    let loopCount = 0;
    const maxLoops = 5;
    const activeMessage = promptMessageText;
    const activeHistory = [...historyExcludingLastUser];
    const activeCitations = [...enrichedCitations];

    while (loopCount < maxLoops) {
      loopCount++;

      const streamResult = await this.streamFromAiService(
        systemPrompt,
        activeMessage,
        activeHistory,
        conversationId,
        activeCitations,
        res,
        userId,
        geminiTools,
      );

      if (streamResult.toolCall) {
        const { name: toolName, args: toolArgs } = streamResult.toolCall;
        res.write(`event: token\ndata: [Executing tool: ${toolName}...] \n\n`);

        let toolResult: any;
        try {
          const plugin = installedTools.find((t) => t.key === toolName);
          if (!plugin) {
            throw new Error(`Tool ${toolName} is not installed`);
          }

          toolResult = await this.marketplaceService.executeInstalledPlugin({
            organizationId: conversation.tenantId,
            pluginId: plugin.id,
            userId,
            inputData: toolArgs,
            conversationId,
          });
        } catch (err: any) {
          toolResult = { error: err.message };
        }

        // Save tool call and response
        await this.conversationService.saveMessage(
          conversationId,
          MessageRole.ASSISTANT,
          JSON.stringify({ type: 'tool_call', name: toolName, args: toolArgs }),
        );
        await this.conversationService.saveMessage(
          conversationId,
          MessageRole.USER,
          JSON.stringify({ type: 'tool_response', name: toolName, response: toolResult }),
        );

        activeHistory.push({
          role: 'assistant',
          content: JSON.stringify({ type: 'tool_call', name: toolName, args: toolArgs }),
        });
        activeHistory.push({
          role: 'user',
          content: JSON.stringify({ type: 'tool_response', name: toolName, response: toolResult }),
        });

        continue;
      }
      break;
    }
  }

  private async streamFromAiService(
    systemPrompt: string,
    message: string,
    history: Array<{ role: string; content: string }>,
    conversationId: string,
    citations: Citation[],
    res: Response,
    userId: string,
    tools?: any[],
  ): Promise<{ fullText: string; tokenCount: number; toolCall: { name: string; args: any } | null }> {
    try {
      const response = await fetch(`${this.aiServiceUrl}/ai/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          systemPrompt,
          message,
          history,
          tools,
        }),
      });

      if (!response.ok || !response.body) {
        this.logger.error(`Failed to stream from AI service: ${response.statusText}`);
        res.write(`event: error\ndata: Failed to generate response\n\n`);
        res.end();
        return { fullText: '', tokenCount: 0, toolCall: null };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantResponse = '';
      let buffer = '';
      let interceptedToolCall: { name: string; args: any } | null = null;
      let currentEvent = 'message';

      let isDone = false;
      while (!isDone) {
        const { done, value } = await reader.read();
        if (done) {
          isDone = true;
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.replace('event: ', '').trim();
          } else if (line.startsWith('data: ')) {
            const dataContent = line.replace('data: ', '').trim();
            if (currentEvent === 'tool_call') {
              interceptedToolCall = JSON.parse(dataContent);
              break;
            } else if (currentEvent === 'token') {
              assistantResponse += dataContent;
              res.write(`event: token\ndata: ${dataContent}\n\n`);
            } else if (currentEvent === 'citation') {
              res.write(`event: citation\ndata: ${dataContent}\n\n`);
            } else if (currentEvent === 'done') {
              // Wait to send done event in orchestrator loop
            }
          } else if (line.trim() === '') {
            res.write('\n');
          }
        }

        if (interceptedToolCall) {
          await reader.cancel();
          break;
        }
      }

      // Process remainder
      if (buffer.trim() && !interceptedToolCall) {
        res.write(`${buffer}\n\n`);
      }

      if (interceptedToolCall) {
        return { fullText: '', tokenCount: 0, toolCall: interceptedToolCall };
      }

      // Save complete assistant message to Postgres if finished
      if (assistantResponse) {
        await this.conversationService.saveMessage(
          conversationId,
          MessageRole.ASSISTANT,
          assistantResponse,
          citations,
        );
      }

      // End connection if finished
      res.write(`event: done\ndata: {}\n\n`);
      res.end();

      return { fullText: assistantResponse, tokenCount: Math.round(assistantResponse.length / 4), toolCall: null };

    } catch (err: any) {
      this.logger.error(`Error streaming from AI service: ${err.message}`);
      res.write(`event: error\ndata: Stream connection failure\n\n`);
      res.end();
      return { fullText: '', tokenCount: 0, toolCall: null };
    }
  }
}
