import { Controller, Post, Body, Req, UseGuards, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { ApiKeysService } from './api-keys.service';
import { UsageService } from '../usage/usage.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { QuotaGuard } from '../quota-guard/quota.guard';
import { RequiresQuota } from '../quota-guard/decorators/quota.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { UsageEventType } from '@prisma/client';

class ExternalChatDto {
  message!: string;
  documentIds?: string[];
}

@Controller('api/v1/external')
@UseGuards(QuotaGuard)
@RequiresQuota('api_call')
export class ApiGatewayController {
  private readonly aiServiceUrl: string;

  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly usage: UsageService,
    private readonly retrieval: RetrievalService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.aiServiceUrl = this.config.get<string>('NEXT_PUBLIC_AI_SERVICE_URL', 'http://localhost:8000');
  }

  @Post('chat')
  async chat(@Req() req: Request, @Body() dto: ExternalChatDto) {
    const apiKeyContext = (req as any).apiKeyContext;
    if (!apiKeyContext) {
      throw new UnauthorizedException('API Key credentials missing');
    }

    const { apiKeyId, organizationId, permissions } = apiKeyContext;

    // Check if key has permissions for chat
    if (!permissions.includes('chat')) {
      throw new ForbiddenException('This API Key does not have the "chat" permission');
    }

    // Resolve a userId for context (creator or org owner)
    const apiKeyRecord = await this.prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      include: {
        organization: {
          include: {
            members: {
              where: { role: 'OWNER' },
              take: 1,
            },
          },
        },
      },
    });

    const userId = apiKeyRecord?.createdById || apiKeyRecord?.organization?.members[0]?.userId;
    if (!userId) {
      throw new ForbiddenException('No valid user context found for this organization');
    }

    let context = '';
    let citations: any[] = [];

    // 1. Retrieve RAG Context if documentIds are present
    if (dto.documentIds && dto.documentIds.length > 0) {
      const retrievalResult = await this.retrieval.retrieveContext(userId, dto.message, dto.documentIds);
      context = retrievalResult.context;
      citations = retrievalResult.chunks.map(chunk => ({
        documentId: chunk.documentId,
        pageNumber: chunk.pageNumber,
        score: chunk.score,
      }));
    }

    // 2. Query LLM Service
    const systemPrompt = `You are a helpful AI Study Assistant. Answer the user query using the following context if relevant:\n\n${context}`;
    
    let assistantResponse = '';
    const tokensIn = Math.round(systemPrompt.length / 4 + dto.message.length / 4);
    let tokensOut = 0;

    const startMs = Date.now();
    try {
      const response = await fetch(`${this.aiServiceUrl}/ai/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          systemPrompt,
          message: dto.message,
          history: [],
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to generate response from AI Service');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
          if (line.startsWith('data: ')) {
            const dataContent = line.replace('data: ', '').trim();
            if (dataContent) {
              assistantResponse += dataContent;
            }
          }
        }
      }

      tokensOut = Math.round(assistantResponse.length / 4);
    } catch (err: any) {
      throw new Error(`LLM Execution Error: ${err.message}`);
    }

    const latencyMs = Date.now() - startMs;

    // 3. Track Usage Events (both API Request and Chat Message)
    await this.usage.track({
      organizationId,
      apiKeyId,
      type: UsageEventType.API_REQUEST,
      metadata: { endpoint: 'chat', status: 'success' },
    });

    await this.usage.track({
      organizationId,
      apiKeyId,
      type: UsageEventType.CHAT_MESSAGE,
      tokensIn,
      tokensOut,
      metadata: { source: 'api_key', apiKeyId },
    });

    // 4. Log API Key usage to DB
    await this.prisma.apiUsageLog.create({
      data: {
        apiKeyId,
        endpoint: 'chat',
        method: 'POST',
        statusCode: 200,
        tokensIn,
        tokensOut,
        latencyMs,
      },
    });

    return {
      response: assistantResponse,
      citations,
      usage: {
        tokensIn,
        tokensOut,
        totalTokens: tokensIn + tokensOut,
        estimatedCostUsd: (tokensIn + tokensOut) * 0.000001,
      },
    };
  }
}
