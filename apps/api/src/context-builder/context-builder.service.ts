import { Injectable, Logger } from '@nestjs/common';
import { ConversationService } from '../conversation/conversation.service';
import { RedisService } from '../redis/redis.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name);
  private readonly aiServiceUrl: string;

  constructor(
    private conversationService: ConversationService,
    private redisService: RedisService,
    private configService: ConfigService,
  ) {
    this.aiServiceUrl = this.configService.get<string>('NEXT_PUBLIC_AI_SERVICE_URL', 'http://localhost:8000');
  }

  async buildContext(
    conversationId: string,
    userId: string,
    limit = 10,
  ): Promise<{ history: Array<{ role: string; content: string }>; summary?: string }> {
    const redis = this.redisService.getClient();
    const summaryKey = `conversation:${conversationId}:summary`;

    // 1. Fetch recent messages
    const messages = await this.conversationService.findLastNMessages(conversationId, limit);
    const history = messages.map((m) => ({
      role: m.role.toLowerCase(),
      content: m.content,
    }));

    // 2. Fetch summary from Redis cache (if exists)
    let summary: string | null = null;
    try {
      summary = await redis.get(summaryKey);
    } catch (err: any) {
      this.logger.warn(`Redis get failed: ${err.message}`);
    }

    // 3. Optional summarization if history is long (e.g. > 15 messages total) and no summary cached
    // Fetch a longer history range to evaluate total messages
    const totalMessages = await this.conversationService.findLastNMessages(conversationId, 50);
    if (totalMessages.length > 15 && !summary) {
      this.logger.log(`History length (${totalMessages.length}) exceeds summarization threshold. Generating summary...`);
      try {
        // Summarize messages older than the last N
        const olderMessages = totalMessages.slice(0, Math.max(0, totalMessages.length - limit));
        if (olderMessages.length > 0) {
          summary = await this.summarizeHistory(olderMessages);
          if (summary) {
            await redis.setex(summaryKey, 3600 * 24, summary); // cache for 24 hours
            this.logger.log(`Summary successfully cached in Redis for conversation: ${conversationId}`);
          }
        }
      } catch (err: any) {
        this.logger.error(`Summarization failed: ${err.message}`);
      }
    }

    return {
      history,
      summary: summary || undefined,
    };
  }

  private async summarizeHistory(messages: any[]): Promise<string> {
    try {
      const response = await fetch(`${this.aiServiceUrl}/ai/chat/summarize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: messages.map((m) => ({
            role: m.role.toLowerCase(),
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`AI summarize response error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.summary || '';
    } catch (err: any) {
      this.logger.error(`Error connecting to AI summarize endpoint: ${err.message}`);
      return '';
    }
  }
}
