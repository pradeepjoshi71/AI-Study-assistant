import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { OnEvent } from '@nestjs/event-emitter';
import { RedisService } from '../../redis/redis.service';

/** Cache TTLs in seconds — central source of truth */
export const CACHE_TTL = {
  RAG_QUERY: 3600,    // 1 hr  — full RAG answer
  CONTEXT: 1800,     // 30 min — conversation memory
  EMBEDDING: 86400,  // 24 hr  — embedding vectors
  GRAPH_EXPAND: 3600, // 1 hr  — concept BFS expansion
  RATE_LIMIT: 60,    // 1 min  — sliding window bucket
  USER_PLAN: 900,    // 15 min — user plan config
  USER_SESSION: 900, // 15 min — user session details
} as const;

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(private readonly redis: RedisService) {}

  // ─── Core primitives ─────────────────────────────────────────────────

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.getClient().get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err: any) {
      this.logger.warn(`Cache GET failed key="${key}": ${err.message}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.getClient().set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err: any) {
      this.logger.warn(`Cache SET failed key="${key}": ${err.message}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.getClient().del(key);
    } catch (err: any) {
      this.logger.warn(`Cache DEL failed key="${key}": ${err.message}`);
    }
  }

  // ─── Cache-first pattern ──────────────────────────────────────────────

  /**
   * Returns cached value if present; otherwise runs factory(), caches result,
   * and returns it. Redis failures fall through to factory transparently.
   */
  async getOrSet<T>(
    key: string,
    ttlSeconds: number,
    factory: () => Promise<T>,
  ): Promise<{ value: T; hit: boolean }> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return { value: cached, hit: true };
    }
    const value = await factory();
    this.set(key, value, ttlSeconds).catch(() => {}); // async write — non-blocking
    return { value, hit: false };
  }

  // ─── Pattern invalidation ─────────────────────────────────────────────

  /**
   * Deletes all keys matching a glob pattern via cursor-based SCAN.
   * Safe for production — never uses KEYS command.
   */
  async invalidatePattern(pattern: string): Promise<number> {
    let deleted = 0;
    try {
      const client = this.redis.getClient();
      let cursor = '0';
      do {
        const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await client.del(...keys);
          deleted += keys.length;
        }
      } while (cursor !== '0');

      if (deleted > 0) {
        this.logger.log(`Invalidated ${deleted} cache keys matching: ${pattern}`);
      }
    } catch (err: any) {
      this.logger.warn(`Cache invalidatePattern failed "${pattern}": ${err.message}`);
    }
    return deleted;
  }

  /**
   * Writes RAG response and tracks the cache key in a user-specific Redis Set.
   */
  async setRagResponse(userId: string, key: string, value: string): Promise<void> {
    try {
      await this.set(key, value, CACHE_TTL.RAG_QUERY);
      const trackingKey = `user:rag-keys:${userId}`;
      const client = this.redis.getClient();
      await client.sadd(trackingKey, key);
      await client.pexpire(trackingKey, CACHE_TTL.RAG_QUERY * 1000);
    } catch (err: any) {
      this.logger.warn(`Failed to track RAG response for user ${userId}: ${err.message}`);
    }
  }

  /**
   * Invalidates all cached RAG queries for a given user.
   */
  async invalidateRagCache(userId: string): Promise<void> {
    try {
      const trackingKey = `user:rag-keys:${userId}`;
      const client = this.redis.getClient();
      const keys = await client.smembers(trackingKey);
      if (keys.length > 0) {
        await client.del(...keys);
        this.logger.log(`Invalidated ${keys.length} RAG cache keys for user: ${userId}`);
      }
      await client.del(trackingKey);
    } catch (err: any) {
      this.logger.warn(`Failed to invalidate RAG cache for user ${userId}: ${err.message}`);
    }
  }

  /**
   * Event listener that invalidates the RAG cache on document upload event.
   */
  @OnEvent('document.uploaded')
  async handleDocumentUploaded(payload: { userId: string; documentId: string }) {
    this.logger.log(`Document upload event received for user: ${payload.userId}. Invalidating RAG cache...`);
    await this.invalidateRagCache(payload.userId);
  }

  // ─── Key builders ─────────────────────────────────────────────────────

  static hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  static ragQueryKey(userId: string, query: string): string {
    const hash = createHash('sha256').update(userId + query).digest('hex');
    return `rag:query:${hash}`;
  }

  static userPlanKey(userId: string): string {
    return `user:plan:${userId}`;
  }

  static userSessionKey(userId: string): string {
    return `user:session:${userId}`;
  }

  static embeddingKey(text: string): string {
    return `embed:${CacheService.hashContent(text)}`;
  }

  static rateLimitKey(userId: string, endpoint: string): string {
    return `rate:${userId}:${endpoint}`;
  }
}

