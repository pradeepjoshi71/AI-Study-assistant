import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  Res,
  UseGuards,
  UseFilters,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Sse,
  MessageEvent,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, Subject } from 'rxjs';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../api-key/guards/api-key.guard';
import { ApiKeyCtx, ApiKeyContext } from '../../api-key/decorators/api-key-context.decorator';
import { Scopes } from '../../api-key/decorators/scopes.decorator';
import { ChatService, SendChatDto } from '../../chat/chat.service';
import { ConversationService } from '../../conversation/conversation.service';
import { envelope } from '../common/envelope';
import { PublicApiExceptionFilter } from '../common/public-api-exception.filter';

class CreateSessionDto {
  title?: string;
  documentIds?: string[];
}

class SendMessageDto {
  message!: string;
  documentIds?: string[];
  mode?: 'study' | 'quiz' | 'flashcard';
}

@ApiTags('Public Chat')
@ApiBearerAuth('bearer')
@UseGuards(ApiKeyGuard)
@UseFilters(PublicApiExceptionFilter)
@Controller({ path: 'api/public/v1/chat', version: VERSION_NEUTRAL })
export class PublicChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly conversationService: ConversationService,
  ) {}

  /**
   * GET /api/public/v1/chat/sessions
   * List all conversation sessions for the org.
   * Scopes: chat:read
   */
  @Get('sessions')
  @Scopes('chat:read')
  @ApiOperation({ summary: 'List chat sessions', description: 'Retrieve all interactive study chat sessions for the authenticated organization.' })
  @ApiResponse({ status: 200, description: 'Chat sessions retrieved successfully.' })
  async listSessions(@Req() req: Request, @ApiKeyCtx() ctx: ApiKeyContext) {
    const userId = ctx.userId ?? ctx.orgId;
    const sessions = await this.conversationService.findConversationsByUser(userId);

    return envelope(
      sessions.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
      })),
      req,
    );
  }

  /**
   * POST /api/public/v1/chat/sessions
   * Create a new conversation session.
   * Scopes: chat:write
   */
  @Post('sessions')
  @Scopes('chat:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create chat session', description: 'Create a new study chat session to begin discussing documents.' })
  @ApiResponse({ status: 201, description: 'Chat session created successfully.' })
  async createSession(
    @Req() req: Request,
    @Body() body: CreateSessionDto,
    @ApiKeyCtx() ctx: ApiKeyContext,
  ) {
    const userId = ctx.userId ?? ctx.orgId;
    const title = body.title ?? 'New Session';
    const session = await this.conversationService.createConversation(userId, title);

    return envelope(
      {
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
      },
      req,
    );
  }

  /**
   * POST /api/public/v1/chat/sessions/:id/messages
   * Send a message and receive an SSE stream.
   *
   * NOTE: SSE via NestJS @Sse decorator requires a route that returns Observable<MessageEvent>.
   * We use a standard @Post and manually set Content-Type: text/event-stream,
   * then delegate to ChatService.handleChatStream which writes directly to the Response.
   * This matches the existing internal chat controller pattern.
   * Scopes: chat:write
   */
  @Post('sessions/:id/messages')
  @Scopes('chat:write')
  @ApiOperation({ summary: 'Send message to chat session', description: 'Post a message into a chat session and receive a streaming Server-Sent Events (SSE) AI response.' })
  @ApiResponse({ status: 200, description: 'Event stream initiated successfully.' })
  async sendMessage(
    @Param('id', ParseUUIDPipe) sessionId: string,
    @Body() body: SendMessageDto,
    @ApiKeyCtx() ctx: ApiKeyContext,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = ctx.userId ?? ctx.orgId;

    // Set SSE headers before delegating
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering

    const dto: SendChatDto = {
      conversationId: sessionId,
      message: body.message,
      documentIds: body.documentIds,
      mode: body.mode ?? 'study',
    };

    // ChatService writes SSE events directly to res and calls res.end()
    await this.chatService.handleChatStream(dto, userId, res, ctx.orgId);
  }
}
