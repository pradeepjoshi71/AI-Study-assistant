import { Controller, Post, Get, Body, Res, Param, UseGuards, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ChatService, SendChatDto } from './chat.service';
import { ConversationService } from '../conversation/conversation.service';
import { Response } from 'express';

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(
    private chatService: ChatService,
    private conversationService: ConversationService,
  ) {}

  @Post('send')
  async sendChat(
    @Body() dto: SendChatDto,
    @CurrentUser('id') userId: string,
    @Res() res: Response,
  ) {
    // Establish SSE connection headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    await this.chatService.handleChatStream(dto, userId, res);
  }

  @Post('regenerate')
  async regenerate(
    @Body('conversationId') conversationId: string,
    @CurrentUser('id') userId: string,
    @Res() res: Response,
  ) {
    // Establish SSE connection headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    await this.chatService.regenerateLastMessage(conversationId, userId, res);
  }

  @Get('list')
  async listConversations(@CurrentUser('id') userId: string) {
    return this.conversationService.findConversationsByUser(userId);
  }

  @Get(':conversationId')
  async getChatHistory(
    @Param('conversationId') conversationId: string,
    @CurrentUser('id') userId: string,
  ) {
    const data = await this.conversationService.findConversationWithMessages(conversationId, userId);
    return {
      conversationId: data.id,
      title: data.title,
      messages: data.messages,
    };
  }
}
