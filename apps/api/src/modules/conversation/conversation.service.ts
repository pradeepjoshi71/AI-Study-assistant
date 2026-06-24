import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Conversation } from './conversation.entity';

@Injectable()
export class ConversationService {
  constructor(private prisma: PrismaService) {}

  async createConversation(
    userId: string,
    tenantId: string,
    title: string,
  ): Promise<Conversation> {
    return this.prisma.conversation.create({
      data: {
        userId,
        tenantId,
        title,
      },
    });
  }

  async findConversations(userId: string, tenantId: string): Promise<Conversation[]> {
    return this.prisma.conversation.findMany({
      where: {
        userId,
        tenantId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findConversationById(
    id: string,
    userId: string,
    tenantId: string,
  ): Promise<Conversation> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.tenantId !== tenantId) {
      throw new ForbiddenException('Tenant access denied');
    }

    if (conversation.userId !== userId) {
      throw new ForbiddenException('User access denied');
    }

    return conversation;
  }

  async updateTitle(
    id: string,
    userId: string,
    tenantId: string,
    title: string,
  ): Promise<Conversation> {
    // Verifies existence and access
    await this.findConversationById(id, userId, tenantId);

    return this.prisma.conversation.update({
      where: { id },
      data: { title },
    });
  }

  async deleteConversation(
    id: string,
    userId: string,
    tenantId: string,
  ): Promise<void> {
    // Verifies existence and access
    await this.findConversationById(id, userId, tenantId);

    await this.prisma.conversation.delete({
      where: { id },
    });
  }

  async updateSummary(
    id: string,
    userId: string,
    tenantId: string,
    summary: string,
  ): Promise<Conversation> {
    await this.findConversationById(id, userId, tenantId);

    return this.prisma.conversation.update({
      where: { id },
      data: { summary },
    });
  }
}
