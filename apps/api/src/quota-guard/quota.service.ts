import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlansService, PlanConfig } from '../billing/plans.service';
import { UsageService } from '../usage/usage.service';
import { UsageEventType, PlanType } from '@prisma/client';

export interface QuotaCheckResult {
  allowed: boolean;
  limitName?: string;
  used?: number;
  limit?: number;
  resetAt?: string;
}

// Maps quota types to plan config fields and Redis event types
const QUOTA_DEFINITIONS: Record<
  string,
  {
    planField: keyof PlanConfig;
    usageType: UsageEventType;
    period: 'daily' | 'monthly';
  }
> = {
  chat: {
    planField: 'maxChatsPerDay',
    usageType: UsageEventType.CHAT_MESSAGE,
    period: 'daily',
  },
  api_call: {
    planField: 'maxApiCallsPerDay',
    usageType: UsageEventType.API_REQUEST,
    period: 'daily',
  },
  tokens: {
    planField: 'maxTokensPerMonth',
    usageType: UsageEventType.CHAT_MESSAGE, // tokens tracked via Redis separately
    period: 'monthly',
  },
};

@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly usage: UsageService,
  ) {}

  /**
   * Primary quota check — Redis first, DB fallback.
   *
   * Performance: ~1-2ms for Redis hits (99% of requests)
   * Fallback: ~20-50ms for DB reads (subscription page changes, etc.)
   */
  async checkQuota(
    organizationId: string,
    quotaType: keyof typeof QUOTA_DEFINITIONS,
  ): Promise<QuotaCheckResult> {
    const def = QUOTA_DEFINITIONS[quotaType];
    if (!def) return { allowed: true };

    // ── 1. Get plan limits from cache or DB ──────────────────
    const planConfig = await this.getPlanConfig(organizationId);
    if (!planConfig) return { allowed: true }; // fail-open on missing config

    const limit = planConfig[def.planField] as number | null;
    if (limit === null) return { allowed: true }; // unlimited plan

    // ── 2. Get current usage from Redis (fast path) ──────────
    const today = new Date().toISOString().split('T')[0];
    let used: number;

    if (quotaType === 'tokens') {
      used = await this.usage.getDailyTokens(organizationId, today);
    } else {
      used = await this.usage.getDailyCount(organizationId, def.usageType, today);
    }

    // ── 3. Check ─────────────────────────────────────────────
    if (used >= limit) {
      this.logger.warn(
        `Quota exceeded: org=${organizationId} type=${quotaType} used=${used} limit=${limit}`,
      );
      return {
        allowed: false,
        limitName: quotaType,
        used,
        limit,
        resetAt: this.getResetTime(def.period),
      };
    }

    return { allowed: true, used, limit };
  }

  /**
   * Batch check for multiple quota types.
   * Used when a single request consumes multiple quota dimensions.
   */
  async checkMultiple(
    organizationId: string,
    quotaTypes: Array<keyof typeof QUOTA_DEFINITIONS>,
  ): Promise<QuotaCheckResult> {
    for (const quotaType of quotaTypes) {
      const result = await this.checkQuota(organizationId, quotaType);
      if (!result.allowed) return result;
    }
    return { allowed: true };
  }

  /**
   * Get the plan config for an org — cached in Redis for 5 minutes.
   */
  private async getPlanConfig(organizationId: string): Promise<PlanConfig | null> {
    const cacheKey = `plan_config:${organizationId}`;
    const client = this.redis.getClient();

    // Try Redis cache first
    const cached = await client.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Cache parsing failed, fallback to DB
      }
    }

    // Fallback to DB
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    });

    if (!subscription) return null;

    const config = this.plans.getPlanConfig(subscription.plan.type as PlanType);
    if (config) {
      await client.set(cacheKey, JSON.stringify(config), 'EX', 300); // 5-min cache
    }

    return config;
  }

  /**
   * Invalidate plan cache on subscription change (call from webhook handler).
   */
  async invalidatePlanCache(organizationId: string): Promise<void> {
    await this.redis.getClient().del(`plan_config:${organizationId}`);
  }

  private getResetTime(period: 'daily' | 'monthly'): string {
    if (period === 'daily') {
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      tomorrow.setUTCHours(0, 0, 0, 0);
      return tomorrow.toISOString();
    }
    // Monthly — first day of next month
    const next = new Date();
    next.setUTCMonth(next.getUTCMonth() + 1, 1);
    next.setUTCHours(0, 0, 0, 0);
    return next.toISOString();
  }
}
