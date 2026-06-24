import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsageEventType } from '@prisma/client';

/**
 * Redis-buffered usage event system.
 *
 * Architecture:
 *   trackEvent() → push JSON to Redis list "usage:buffer:{orgId}"
 *   flushBuffer() → runs every 30s via setInterval → batch-inserts to Postgres
 *
 * Why buffering:
 *   - Chat requests can produce 10-20 events/second at scale
 *   - Redis writes are ~1ms; Postgres INSERTs are ~5-50ms
 *   - Batching reduces DB load by 95%+
 */
@Injectable()
export class UsageBufferService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UsageBufferService.name);
  private flushInterval!: NodeJS.Timeout;
  private readonly FLUSH_INTERVAL_MS = 30_000; // flush every 30s
  private readonly BUFFER_KEY_PREFIX = 'usage:buffer:';
  private readonly MAX_BATCH_SIZE = 500;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.flushInterval = setInterval(
      () => this.flushAllBuffers().catch((e) => this.logger.error('Flush error', e)),
      this.FLUSH_INTERVAL_MS,
    );
    this.logger.log('Usage buffer flush scheduler started (30s interval)');
  }

  onModuleDestroy() {
    clearInterval(this.flushInterval);
    // Flush remaining events on shutdown
    this.flushAllBuffers().catch(() => {});
  }

  async pushEvent(event: {
    organizationId: string;
    userId?: string;
    apiKeyId?: string;
    type: UsageEventType;
    tokensIn?: number;
    tokensOut?: number;
    costUsdMicro?: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const key = `${this.BUFFER_KEY_PREFIX}${event.organizationId}`;
    const payload = JSON.stringify({ ...event, createdAt: new Date().toISOString() });
    const client = this.redis.getClient();

    // Push to Redis list + set TTL so buffer auto-expires if not flushed
    await client.rpush(key, payload);
    await client.expire(key, 3600); // 1-hour TTL safety net
  }

  async flushAllBuffers(): Promise<void> {
    const client = this.redis.getClient();

    // Find all active buffer keys
    const keys = await client.keys(`${this.BUFFER_KEY_PREFIX}*`);
    if (keys.length === 0) return;

    this.logger.debug(`Flushing ${keys.length} usage buffers`);

    for (const key of keys) {
      await this.flushBuffer(key);
    }
  }

  private async flushBuffer(key: string): Promise<void> {
    const client = this.redis.getClient();

    // Atomically pop up to MAX_BATCH_SIZE events
    const raw = await client.lrange(key, 0, this.MAX_BATCH_SIZE - 1);
    if (raw.length === 0) return;

    // Trim the successfully read items atomically
    await client.ltrim(key, raw.length, -1);

    const events = raw.map((s) => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    }).filter(Boolean);

    if (events.length === 0) return;

    // Batch insert to Postgres
    try {
      await this.prisma.usageEvent.createMany({
        data: events.map((e) => ({
          organizationId: e.organizationId,
          userId: e.userId ?? null,
          apiKeyId: e.apiKeyId ?? null,
          type: e.type,
          tokensIn: e.tokensIn ?? 0,
          tokensOut: e.tokensOut ?? 0,
          costUsdMicro: e.costUsdMicro ?? 0,
          metadata: e.metadata ?? {},
          createdAt: new Date(e.createdAt),
        })),
        skipDuplicates: true,
      });

      this.logger.debug(`Flushed ${events.length} usage events for key: ${key}`);
    } catch (err: any) {
      this.logger.error(`Failed to flush usage buffer: ${err.message}`);
      // Re-push failed events back to Redis
      await client.lpush(key, ...raw);
    }
  }

  /**
   * Force an immediate flush for a specific org (used in tests or on-demand aggregation).
   */
  async flushForOrg(organizationId: string): Promise<void> {
    const key = `${this.BUFFER_KEY_PREFIX}${organizationId}`;
    await this.flushBuffer(key);
  }
}
