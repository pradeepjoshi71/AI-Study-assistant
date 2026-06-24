import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Message } from './message.entity';
import { MessageRole } from '@prisma/client';

@Injectable()
export class MessageService {
  constructor(private prisma: PrismaService) {}

  async createMessage(
    conversationId: string,
    tenantId: string,
    role: MessageRole,
    content: string,
    citations?: any,
  ): Promise<Message> {
    // Verify conversation tenantId matches before adding a message
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.tenantId !== tenantId) {
      throw new ForbiddenException('Tenant access denied');
    }

    return this.prisma.message.create({
      data: {
        conversationId,
        tenantId,
        role,
        content,
        citations: citations ? JSON.parse(JSON.stringify(citations)) : undefined,
      },
    });
  }

  async findMessagesByConversation(
    conversationId: string,
    tenantId: string,
    limit?: number,
  ): Promise<Message[]> {
    // Verify conversation ownership and tenant isolation
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.tenantId !== tenantId) {
      throw new ForbiddenException('Tenant access denied');
    }

    return this.prisma.message.findMany({
      where: {
        conversationId,
        tenantId,
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: limit,
    });
  }

  async deleteMessage(id: string, tenantId: string): Promise<void> {
    const message = await this.prisma.message.findUnique({
      where: { id },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.tenantId !== tenantId) {
      throw new ForbiddenException('Tenant access denied');
    }

    await this.prisma.message.delete({
      where: { id },
    });
  }
}
