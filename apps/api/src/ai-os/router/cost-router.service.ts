import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

export interface AIComputeUnit {
  type: string; // "CHAT", "EMBEDDING", "SUMMARIZATION", "REASONING", "BATCH"
  model: string;
  costPer1kTokensInCents: number;
  latencyProfile: 'low' | 'medium' | 'high';
}

@Injectable()
export class CostRouterService {
  private readonly logger = new Logger(CostRouterService.name);
  private readonly geminiApiKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.geminiApiKey = this.config.get<string>('GEMINI_API_KEY', '');
  }

  /**
   * Determine the best compute unit based on task type and complexity.
   */
  routeComputeUnit(type: string, inputLength: number): AIComputeUnit {
    switch (type) {
      case 'EMBEDDING':
        return {
          type,
          model: 'text-embedding-004',
          costPer1kTokensInCents: 0.001,
          latencyProfile: 'low',
        };
      case 'REASONING':
        return {
          type,
          model: 'gemini-1.5-pro',
          costPer1kTokensInCents: 0.075,
          latencyProfile: 'high',
        };
      case 'SUMMARIZATION':
        return {
          type,
          model: 'gemini-1.5-flash',
          costPer1kTokensInCents: 0.0075,
          latencyProfile: 'medium',
        };
      case 'BATCH':
        return {
          type,
          model: 'gemini-1.5-flash',
          costPer1kTokensInCents: 0.0075,
          latencyProfile: 'high',
        };
      case 'CHAT':
      default:
        // For very large inputs, fall back to gemini-1.5-pro, otherwise flash
        if (inputLength > 10000) {
          return {
            type,
            model: 'gemini-1.5-pro',
            costPer1kTokensInCents: 0.075,
            latencyProfile: 'medium',
          };
        }
        return {
          type,
          model: 'gemini-1.5-flash',
          costPer1kTokensInCents: 0.0075,
          latencyProfile: 'low',
        };
    }
  }

  /**
   * Check if we have a cached response for this exact task input payload.
   */
  async getCachedResponse(tenantId: string, inputHash: string): Promise<any | null> {
    const redisKey = `tenant:${tenantId}:cache:${inputHash}`;
    const client = this.redis.getClient();
    const cached = await client.get(redisKey);
    if (cached) {
      this.logger.log(`CostRouter cache HIT for tenant=${tenantId}`);
      return JSON.parse(cached);
    }
    return null;
  }

  /**
   * Cache the response to save future LLM costs.
   */
  async setCachedResponse(tenantId: string, inputHash: string, response: any, ttl = 3600): Promise<void> {
    const redisKey = `tenant:${tenantId}:cache:${inputHash}`;
    const client = this.redis.getClient();
    await client.set(redisKey, JSON.stringify(response), 'EX', ttl);
  }

  /**
   * Run direct LLM call on Gemini and log detailed token utilization.
   */
  async executeLlmCall(
    tenantId: string,
    executionId: string,
    systemPrompt: string,
    prompt: string,
    computeUnit: AIComputeUnit,
  ): Promise<string> {
    const startTime = Date.now();
    const hasKey = this.geminiApiKey && this.geminiApiKey !== 'your_gemini_api_key_here';
    
    if (!hasKey) {
      // Mock LLM implementation if API key is not configured
      const latencyMs = 200;
      const tokensIn = Math.ceil(prompt.length / 4);
      const tokensOut = 50;
      const costCents = (tokensIn + tokensOut) * (computeUnit.costPer1kTokensInCents / 1000);

      await this.prisma.aiComputeLog.create({
        data: {
          executionId,
          model: computeUnit.model,
          tokensIn,
          tokensOut,
          costCents,
          latencyMs,
        },
      });

      return `[Mock response from ${computeUnit.model}] For prompt: "${prompt.slice(0, 30)}..."`;
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${computeUnit.model}:generateContent?key=${this.geminiApiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: `${systemPrompt}\n\nUser request: ${prompt}` }],
            },
          ],
        }),
      });

      if (!res.ok) {
        throw new Error(`Gemini LLM returned: ${res.statusText}`);
      }

      const body = await res.json();
      const text = body?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      // Calculate token stats
      const tokensIn = Math.ceil((systemPrompt.length + prompt.length) / 4);
      const tokensOut = Math.ceil(text.length / 4);
      const latencyMs = Date.now() - startTime;
      const costCents = (tokensIn + tokensOut) * (computeUnit.costPer1kTokensInCents / 1000);

      // Log to database
      await this.prisma.aiComputeLog.create({
        data: {
          executionId,
          model: computeUnit.model,
          tokensIn,
          tokensOut,
          costCents,
          latencyMs,
        },
      });

      return text;
    } catch (err: any) {
      this.logger.error(`Gemini call failed: ${err.message}`);
      throw err;
    }
  }
}
