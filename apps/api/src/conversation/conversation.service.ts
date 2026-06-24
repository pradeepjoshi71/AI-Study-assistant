import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Conversation, Message, MessageRole } from '@prisma/client';

@Injectable()
export class ConversationService {
  constructor(private prisma: PrismaService) {}

  async createConversation(userId: string, title: string): Promise<Conversation> {
    return this.prisma.conversation.create({
      data: {
        userId,
        tenantId: 'default-tenant',
        title,
      },
    });
  }

  async findConversationsByUser(userId: string): Promise<Conversation[]> {
    return this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findConversationById(conversationId: string, userId: string): Promise<Conversation> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.userId !== userId) {
      throw new ForbiddenException('Access denied to this conversation');
    }

    return conversation;
  }

  async findConversationWithMessages(conversationId: string, userId: string): Promise<Conversation & { messages: Message[] }> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.userId !== userId) {
      throw new ForbiddenException('Access denied to this conversation');
    }

    return conversation;
  }

  async saveMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    citations?: any,
  ): Promise<Message> {
    return this.prisma.message.create({
      data: {
        conversationId,
        tenantId: 'default-tenant',
        role,
        content,
        citations: citations ? JSON.parse(JSON.stringify(citations)) : undefined,
      },
    });
  }

  async findLastNMessages(conversationId: string, limit: number): Promise<Message[]> {
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }).then((msgs) => msgs.reverse()); // Put back in chronological order
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.prisma.message.delete({
      where: { id: messageId },
    });
  }

  async updateConversationTitle(conversationId: string, userId: string, title: string): Promise<Conversation> {
    await this.findConversationById(conversationId, userId);

    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { title },
    });
  }

  async deleteConversation(conversationId: string, userId: string): Promise<void> {
    await this.findConversationById(conversationId, userId);

    await this.prisma.conversation.delete({
      where: { id: conversationId },
    });
  }
}
