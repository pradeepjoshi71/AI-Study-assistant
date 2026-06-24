import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { ChatMemory } from './memory.types';

@Injectable()
export class MemoryRepository {
  private readonly logger = new Logger(MemoryRepository.name);
  private readonly prefix = 'chat:memory:';
  private readonly defaultTtl = 3600; // 1 hour

  constructor(private redisService: RedisService) {}

  async getMemory(conversationId: string): Promise<ChatMemory | null> {
    const client = this.redisService.getClient();
    const key = `${this.prefix}${conversationId}`;
    try {
      const data = await client.get(key);
      if (!data) return null;
      return JSON.parse(data);
    } catch (err: any) {
      this.logger.error(`Failed to load chat memory from Redis: ${err.message}`);
      return null;
    }
  }

  async setMemory(
    conversationId: string,
    memory: ChatMemory,
    ttlSeconds = this.defaultTtl,
  ): Promise<void> {
    const client = this.redisService.getClient();
    const key = `${this.prefix}${conversationId}`;
    try {
      await client.setex(key, ttlSeconds, JSON.stringify(memory));
    } catch (err: any) {
      this.logger.error(`Failed to cache chat memory in Redis: ${err.message}`);
    }
  }

  async deleteMemory(conversationId: string): Promise<void> {
    const client = this.redisService.getClient();
    const key = `${this.prefix}${conversationId}`;
    try {
      await client.del(key);
    } catch (err: any) {
      this.logger.error(`Failed to delete chat memory in Redis: ${err.message}`);
    }
  }
}
