import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ApiKeyContext } from './decorators/api-key-context.decorator';

const CACHE_TTL_SECONDS = 300; // 5 minutes

export interface CachedApiKey extends ApiKeyContext {
  status: string;
  expiresAt: string | null;
}

@Injectable()
export class ApiKeyCacheService {
  private readonly logger = new Logger(ApiKeyCacheService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Resolve an API key from Redis cache (TTL 5min), falling back to Postgres.
   * Throws UnauthorizedException if not found or revoked in DB.
   */
  async resolve(keyHash: string): Promise<CachedApiKey> {
    const cacheKey = `apikey:${keyHash}`;

    // ─── 1. Redis cache read ──────────────────────────────────────────────
    try {
      const cached = await this.redis.getClient().get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as CachedApiKey;
      }
    } catch (err: any) {
      this.logger.warn(`Redis cache read failed for API key: ${err.message}`);
    }

    // ─── 2. DB fallback ───────────────────────────────────────────────────
    const key = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        scopes: true,
        status: true,
        expiresAt: true,
      },
    });

    if (!key) {
      throw new UnauthorizedException({ code: 'INVALID_API_KEY', message: 'API key not found.' });
    }

    const payload: CachedApiKey = {
      keyId: key.id,
      orgId: key.organizationId,
      userId: key.userId ?? null,
      scopes: key.scopes as string[],
      status: key.status as string,
      expiresAt: key.expiresAt ? key.expiresAt.toISOString() : null,
    };

    // ─── 3. Populate cache (skip if already REVOKED/EXPIRED — no point caching) ──
    if (key.status === 'ACTIVE') {
      try {
        await this.redis
          .getClient()
          .set(cacheKey, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS);
      } catch (err: any) {
        this.logger.warn(`Redis cache write failed for API key: ${err.message}`);
      }
    }

    return payload;
  }

  /** Evict a key from the Redis cache (call on revoke/status change). */
  async evict(keyHash: string): Promise<void> {
    try {
      await this.redis.getClient().del(`apikey:${keyHash}`);
    } catch (err: any) {
      this.logger.warn(`Redis cache eviction failed: ${err.message}`);
    }
  }
}
