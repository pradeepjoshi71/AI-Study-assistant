import { Injectable, Logger } from '@nestjs/common';
import { UsageBufferService } from './usage-buffer.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { UsageEventType } from '@prisma/client';

export interface TrackEventParams {
  organizationId: string;
  userId?: string;
  apiKeyId?: string;
  type: UsageEventType;
  tokensIn?: number;
  tokensOut?: number;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  // Cost table in USD micro-cents per 1000 tokens (our platform cost from Gemini)
  private readonly GEMINI_COST_PER_1K_TOKENS_MICRO = 1; // $0.000001 per token

  constructor(
    private readonly buffer: UsageBufferService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ─── Track usage event ────────────────────────────────────

  async track(params: TrackEventParams): Promise<void> {
    const totalTokens = (params.tokensIn ?? 0) + (params.tokensOut ?? 0);
    const costUsdMicro = Math.ceil(
      (totalTokens / 1000) * this.GEMINI_COST_PER_1K_TOKENS_MICRO,
    );

    // 1. Push to Redis buffer (fast, non-blocking)
    await this.buffer.pushEvent({ ...params, costUsdMicro });

    // 2. Increment real-time Redis counters (for quota checks — synchronous)
    await this.incrementRedisCounters(params.organizationId, params.type, totalTokens);

    // 3. Increment DB subscription usage counter (async, best-effort)
    if (params.type === UsageEventType.CHAT_MESSAGE) {
      this.prisma.subscription
        .updateMany({
          where: { organizationId: params.organizationId },
          data: {
            currentPeriodChatsUsed: { increment: 1 },
            currentPeriodTokensUsed: { increment: totalTokens },
          },
        })
        .catch((e) => this.logger.warn(`Failed to increment subscription usage: ${e.message}`));
    } else if (params.type === UsageEventType.API_REQUEST) {
      this.prisma.subscription
        .updateMany({
          where: { organizationId: params.organizationId },
          data: { currentPeriodApiCallsUsed: { increment: 1 } },
        })
        .catch(() => {});
    }
  }

  // ─── Redis real-time counters ─────────────────────────────

  private async incrementRedisCounters(
    organizationId: string,
    type: UsageEventType,
    tokens: number,
  ): Promise<void> {
    const client = this.redis.getClient();
    const today = new Date().toISOString().split('T')[0]; // "2024-06-24"
    const ttl = 86400 * 2; // 2 days TTL

    const pipe = client.pipeline();

    // Daily counters per event type
    const counterKey = `usage:daily:${organizationId}:${today}:${type}`;
    pipe.incr(counterKey);
    pipe.expire(counterKey, ttl);

    // Token counter
    if (tokens > 0) {
      const tokenKey = `usage:daily:${organizationId}:${today}:tokens`;
      pipe.incrby(tokenKey, tokens);
      pipe.expire(tokenKey, ttl);
    }

    await pipe.exec();
  }

  async getDailyCount(
    organizationId: string,
    type: UsageEventType,
    date?: string,
  ): Promise<number> {
    const d = date ?? new Date().toISOString().split('T')[0];
    const key = `usage:daily:${organizationId}:${d}:${type}`;
    const val = await this.redis.getClient().get(key);
    return parseInt(val ?? '0', 10);
  }

  async getDailyTokens(organizationId: string, date?: string): Promise<number> {
    const d = date ?? new Date().toISOString().split('T')[0];
    const key = `usage:daily:${organizationId}:${d}:tokens`;
    const val = await this.redis.getClient().get(key);
    return parseInt(val ?? '0', 10);
  }

  // ─── Usage queries ────────────────────────────────────────

  async getOrganizationUsage(organizationId: string, days = 30) {
    const since = new Date(Date.now() - days * 86400 * 1000);
    const [events, aggregates, subscription] = await Promise.all([
      this.prisma.usageEvent.groupBy({
        by: ['type'],
        where: { organizationId, createdAt: { gte: since } },
        _count: true,
        _sum: { tokensIn: true, tokensOut: true, costUsdMicro: true },
      }),
      this.prisma.usageAggregate.findMany({
        where: { organizationId, granularity: 'daily', period: { gte: since.toISOString().split('T')[0] } },
        orderBy: { period: 'asc' },
        take: 60,
      }),
      this.prisma.subscription.findUnique({
        where: { organizationId },
        include: { plan: true },
      }),
    ]);

    return { events, aggregates, subscription };
  }

  async getUserUsage(organizationId: string, userId: string, days = 7) {
    const since = new Date(Date.now() - days * 86400 * 1000);
    return this.prisma.usageEvent.groupBy({
      by: ['type'],
      where: { organizationId, userId, createdAt: { gte: since } },
      _count: true,
      _sum: { tokensIn: true, tokensOut: true, costUsdMicro: true },
    });
  }

  // ─── Business metrics ─────────────────────────────────────

  async getRevenueMetrics(days = 30) {
    const since = new Date(Date.now() - days * 86400 * 1000);
    const [totalRevenue, invoices, activeSubscriptions] = await Promise.all([
      this.prisma.invoice.aggregate({
        _sum: { amountPaidUsdCents: true },
        where: { status: 'PAID', paidAt: { gte: since } },
      }),
      this.prisma.invoice.findMany({
        where: { status: 'PAID', paidAt: { gte: since } },
        include: { organization: { select: { name: true } } },
        orderBy: { paidAt: 'desc' },
        take: 20,
      }),
      this.prisma.subscription.count({ where: { status: { in: ['ACTIVE', 'TRIALING'] } } }),
    ]);

    return {
      totalRevenueCents: totalRevenue._sum.amountPaidUsdCents ?? 0,
      activeSubscriptions,
      recentInvoices: invoices,
    };
  }
}
