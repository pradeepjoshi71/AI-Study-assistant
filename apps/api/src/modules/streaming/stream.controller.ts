import { Controller, Post, Body, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ConversationService } from '../conversation/conversation.service';
import { MessageService } from '../messages/message.service';
import { ContextBuilderService } from '../context-builder/context-builder.service';
import { PromptBuilder } from '../prompt-engine/prompt.builder';
import { CitationMapper } from '../citations/citation.mapper';
import { StreamService } from './stream.service';
import { MemoryService } from '../memory/memory.service';
import { MessageRole } from '@prisma/client';

export class ChatStreamDto {
  conversationId?: string;
  message!: string;
  documentIds?: string[];
  mode!: 'study' | 'quiz' | 'flashcard';
}

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class StreamController {
  constructor(
    private conversationService: ConversationService,
    private messageService: MessageService,
    private contextBuilderService: ContextBuilderService,
    private promptBuilder: PromptBuilder,
    private citationMapper: CitationMapper,
    private streamService: StreamService,
    private memoryService: MemoryService,
  ) {}

  @Post('stream')
  async streamChat(
    @Body() dto: ChatStreamDto,
    @CurrentUser('id') userId: string,
    @Res() res: Response,
  ) {
    // 1. Establish SSE Connection Headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Use userId as tenantId for user-isolated multi-tenant sandbox
    const tenantId = userId;
    let conversationId = dto.conversationId;

    try {
      // 2. Validate/Create Conversation in Postgres
      if (!conversationId) {
        const title = dto.message.slice(0, 30) || 'New Study Room';
        const conversation = await this.conversationService.createConversation(userId, tenantId, title);
        conversationId = conversation.id;
        
        // Emit conversationId event first
        res.write(`event: conversationId\ndata: ${conversationId}\n\n`);
      } else {
        await this.conversationService.findConversationById(conversationId, userId, tenantId);
      }

      // 3. Save User message in PostgreSQL
      await this.messageService.createMessage(
        conversationId,
        tenantId,
        MessageRole.USER,
        dto.message,
      );

      // 4. Compile RAG Context package (fetches history & searches Qdrant)
      const contextPackage = await this.contextBuilderService.buildContext({
        conversationId,
        userQuery: dto.message,
        documentIds: dto.documentIds,
        tenantId,
        userId,
      });

      // 5. Enrich chunks to frontend-friendly Citations format
      const enrichedCitations = this.citationMapper.mapCitations(
        contextPackage.retrievedChunks.map((c) => ({
          chunk_id: c.chunkId,
          quote: c.text.slice(0, 150),
        })),
        contextPackage.retrievedChunks,
      );

      // 6. Build strict RAG prompts using Prompt Engine
      const { systemPrompt } = this.promptBuilder.buildPrompt({
        query: dto.message,
        chatHistory: contextPackage.recentMessages,
        chatHistorySummary: contextPackage.chatHistorySummary,
        retrievedChunks: contextPackage.retrievedChunks,
        synthesizedContext: contextPackage.synthesizedContext,
        conflicts: contextPackage.conflicts,
      });

      // 7. Stream LLM Generation and pipe response
      const assistantText = await this.streamService.pipeStream(
        systemPrompt,
        dto.message,
        contextPackage.recentMessages.map((m) => ({
          role: m.role.toLowerCase(),
          content: m.content,
        })),
        enrichedCitations,
        res,
      );

      // 8. Save Assistant message in PostgreSQL
      if (assistantText) {
        await this.messageService.createMessage(
          conversationId,
          tenantId,
          MessageRole.ASSISTANT,
          assistantText,
          enrichedCitations,
        );
      }

      // 9. Update memory system cache and asynchronously trigger summarization if necessary
      if (conversationId) {
        await this.memoryService.updateMemory(conversationId, userId, tenantId);
      }

    } catch (err: any) {
      res.write(`event: error\ndata: ${err.message || 'Stream processing failed'}\n\n`);
      res.write(`event: done\ndata: {}\n\n`);
      res.end();
    }
  }
}
