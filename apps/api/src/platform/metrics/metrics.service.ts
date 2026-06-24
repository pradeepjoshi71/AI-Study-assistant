import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { DocumentStatus, SubscriptionStatus, SubscriptionPlan } from '@prisma/client';

// Estimated infra cost per tenant per month (USD)
const COST_PER_TENANT: Record<string, number> = {
  FREE:       0.35,
  PRO:        2.10,
  TEAM:       8.50,
  ENTERPRISE: 45.00,
};

export interface PlatformMetrics {
  // ── Revenue ───────────────────────────────────────────────────────────────
  mrr:                    number;
  arr:                    number;
  mrrGrowthRate:          number;
  arrGrowthRate:          number;

  // ── Customer Metrics ──────────────────────────────────────────────────────
  totalCustomers:         number;
  customersByPlan:        Record<string, number>;
  newCustomersThisMonth:  number;
  churnedThisMonth:       number;
  netNewCustomers:        number;

  // ── Retention Metrics ─────────────────────────────────────────────────────
  churnRate:              number;
  ndr:                    number;
  ltv:                    number;
  cac:                    number;
  ltvCacRatio:            number;

  // ── Engagement ────────────────────────────────────────────────────────────
  dau:                    number;
  mau:                    number;
  dauMauRatio:            number;

  // ── Unit Economics ────────────────────────────────────────────────────────
  grossMargin:            number;
  revenuePerEmployee:     number;
  aiCostPerQuery:         number;
  cacheHitRatio:          number;

  // ── Scale Indicators ─────────────────────────────────────────────────────
  totalAiQueries:         number;
  aiQueriesThisMonth:     number;
  documentsProcessed:     number;
  vectorsStored:          number;

  // ── Infrastructure Cost ───────────────────────────────────────────────────
  monthlyInfrastructureCost: number;
  revenueToInfraRatio:    number;

  // ── Timestamps ───────────────────────────────────────────────────────────
  calculatedAt:           Date;
  periodStart:            Date;
  periodEnd:              Date;
}

export interface CohortAnalysis {
  cohortMonth:    string;
  newUsers:       number;
  retained: {
    month1:  number;
    month3:  number;
    month6:  number;
    month12: number;
  };
  expansion: {
    month3: number;
    month6: number;
  };
}

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly logger = new Logger(MetricsService.name);
  private readonly CACHE_KEY_METRICS = 'platform:metrics:snapshot';
  private readonly CACHE_KEY_COHORTS = 'platform:metrics:cohorts';
  private readonly CACHE_TTL_SECONDS = 300; // 5 minutes
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ── Lifecycle: Start background refresh on module init ───────────────────
  onModuleInit() {
    // Refresh metrics cache every 5 minutes (replaces @Cron without @nestjs/schedule)
    this.refreshInterval = setInterval(() => {
      this.refreshMetricsCache().catch(err =>
        this.logger.error('Background metrics refresh failed', err),
      );
    }, this.CACHE_TTL_SECONDS * 1000);
  }

  // ── Redis helpers ─────────────────────────────────────────────────────────
  private async redisGet(key: string): Promise<string | null> {
    return this.redis.getClient().get(key);
  }

  private async redisSet(key: string, value: string, ttl: number): Promise<void> {
    await this.redis.getClient().set(key, value, 'EX', ttl);
  }

  // ── Main metrics snapshot (cached 5 minutes) ─────────────────────────────
  async getPlatformMetrics(): Promise<PlatformMetrics> {
    const cached = await this.redisGet(this.CACHE_KEY_METRICS);
    if (cached) {
      return JSON.parse(cached) as PlatformMetrics;
    }
    const metrics = await this.computeMetrics();
    await this.redisSet(this.CACHE_KEY_METRICS, JSON.stringify(metrics), this.CACHE_TTL_SECONDS);
    return metrics;
  }

  // ── Core computation ─────────────────────────────────────────────────────
  private async computeMetrics(): Promise<PlatformMetrics> {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const [
      currentMrr,
      lastMonthMrr,
      customersByPlan,
      newCustomers,
      churnedCustomers,
      engagementStats,
      aiStats,
      infraCost,
    ] = await Promise.all([
      this.computeMRR(),
      this.computeMRRForPeriod(lastMonthStart, lastMonthEnd),
      this.getCustomersByPlan(),
      this.getNewOrgsThisMonth(periodStart),
      this.getChurnedOrgsThisMonth(periodStart),
      this.getEngagementStats(periodStart),
      this.getAIStats(periodStart),
      this.getMonthlyInfrastructureCost(),
    ]);

    const totalCustomers = Object.values(customersByPlan).reduce((a, b) => a + b, 0);
    const mrrGrowthRate = lastMonthMrr > 0
      ? ((currentMrr - lastMonthMrr) / lastMonthMrr) * 100
      : 0;

    const churnRate = totalCustomers > 0
      ? (churnedCustomers / totalCustomers) * 100
      : 0;

    const arpu = totalCustomers > 0 ? currentMrr / totalCustomers : 0;
    const monthlyChurnDecimal = churnRate / 100;
    const ltv = monthlyChurnDecimal > 0
      ? (arpu / monthlyChurnDecimal) * 0.85
      : arpu * 24;

    const ndr = lastMonthMrr > 0 ? (currentMrr / lastMonthMrr) * 100 : 100;

    const grossMarginPct = this.computeGrossMargin(customersByPlan, currentMrr, infraCost);
    const aiCostPerQuery = aiStats.totalCostUsd / Math.max(aiStats.totalQueries, 1);

    const estimatedCac = await this.estimateCAC(periodStart);

    return {
      mrr:          Math.round(currentMrr * 100) / 100,
      arr:          Math.round(currentMrr * 12 * 100) / 100,
      mrrGrowthRate: Math.round(mrrGrowthRate * 100) / 100,
      arrGrowthRate: Math.round(mrrGrowthRate * 100) / 100,

      totalCustomers,
      customersByPlan,
      newCustomersThisMonth:  newCustomers,
      churnedThisMonth:       churnedCustomers,
      netNewCustomers:        newCustomers - churnedCustomers,

      churnRate:    Math.round(churnRate * 100) / 100,
      ndr:          Math.round(ndr * 100) / 100,
      ltv:          Math.round(ltv * 100) / 100,
      cac:          estimatedCac,
      ltvCacRatio:  Math.round((ltv / Math.max(estimatedCac, 1)) * 10) / 10,

      dau:          engagementStats.dau,
      mau:          engagementStats.mau,
      dauMauRatio:  engagementStats.mau > 0
        ? Math.round((engagementStats.dau / engagementStats.mau) * 10000) / 100
        : 0,

      grossMargin:        grossMarginPct,
      revenuePerEmployee: Math.round(currentMrr * 12 / 15),
      aiCostPerQuery:     Math.round(aiCostPerQuery * 100000) / 100000,
      cacheHitRatio:      aiStats.cacheHitRatio,

      totalAiQueries:      aiStats.allTimeQueries,
      aiQueriesThisMonth:  aiStats.totalQueries,
      documentsProcessed:  aiStats.documentsProcessed,
      vectorsStored:       aiStats.vectorsStored,

      monthlyInfrastructureCost: Math.round(infraCost * 100) / 100,
      revenueToInfraRatio:       infraCost > 0
        ? Math.round((currentMrr / infraCost) * 10) / 10
        : 0,

      calculatedAt: now,
      periodStart,
      periodEnd:    now,
    };
  }

  // ── MRR: computed from Organization → Subscription → Plan.priceMonthlyUsdCents ──
  private async computeMRR(): Promise<number> {
    // Join subscriptions with their plans to get the monthly price
    const activeSubs = await this.prisma.subscription.findMany({
      where: { status: SubscriptionStatus.ACTIVE },
      include: { plan: { select: { priceMonthlyUsdCents: true } } },
    });

    return activeSubs.reduce((total, sub) => {
      const monthlyUsd = (sub.plan?.priceMonthlyUsdCents ?? 0) / 100;
      return total + monthlyUsd;
    }, 0);
  }

  private async computeMRRForPeriod(start: Date, end: Date): Promise<number> {
    const subs = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        createdAt: { lte: end },
        OR: [
          { canceledAt: null },
          { canceledAt: { gte: start } },
        ],
      },
      include: { plan: { select: { priceMonthlyUsdCents: true } } },
    });

    return subs.reduce((total, sub) => {
      return total + (sub.plan?.priceMonthlyUsdCents ?? 0) / 100;
    }, 0);
  }

  // ── Customer segmentation by plan type ────────────────────────────────────
  private async getCustomersByPlan(): Promise<Record<string, number>> {
    // Count organizations by their subscription plan type
    const activeSubs = await this.prisma.subscription.findMany({
      where: { status: SubscriptionStatus.ACTIVE },
      include: { plan: { select: { type: true } } },
    });

    const result: Record<string, number> = { FREE: 0, PRO: 0, TEAM: 0, ENTERPRISE: 0 };
    activeSubs.forEach(sub => {
      const planType = sub.plan?.type ?? 'FREE';
      const key = String(planType);
      if (result[key] !== undefined) {
        result[key]++;
      }
    });

    // Free tier: users without a paid active subscription
    const freeUsers = await this.prisma.user.count({
      where: { subscriptionPlan: SubscriptionPlan.FREE },
    });
    result.FREE = freeUsers;

    return result;
  }

  private async getNewOrgsThisMonth(since: Date): Promise<number> {
    return this.prisma.subscription.count({
      where: {
        status: SubscriptionStatus.ACTIVE,
        createdAt: { gte: since },
      },
    });
  }

  private async getChurnedOrgsThisMonth(since: Date): Promise<number> {
    return this.prisma.subscription.count({
      where: {
        status: SubscriptionStatus.CANCELED,
        canceledAt: { gte: since },
      },
    });
  }

  // ── Engagement: DAU/MAU via Session model ────────────────────────────────
  private async getEngagementStats(periodStart: Date): Promise<{
    dau: number;
    mau: number;
  }> {
    const cachedDau = await this.redisGet('metrics:dau:count');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    let dau: number;
    if (cachedDau) {
      dau = parseInt(cachedDau, 10);
    } else {
      dau = await this.prisma.session.count({
        where: { lastActiveAt: { gte: yesterday } },
      });
      await this.redisSet('metrics:dau:count', String(dau), 3600);
    }

    const mau = await this.prisma.session.count({
      where: { lastActiveAt: { gte: periodStart } },
    });

    return { dau, mau };
  }

  // ── AI usage stats (from CostTracking + DocumentChunk) ───────────────────
  private async getAIStats(periodStart: Date): Promise<{
    totalQueries: number;
    allTimeQueries: number;
    totalCostUsd: number;
    cacheHitRatio: number;
    documentsProcessed: number;
    vectorsStored: number;
  }> {
    const currentPeriod = `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, '0')}`;

    // Use CostTracking as the AI query/cost proxy
    const [monthCost, allTimeCost, cacheHits, cacheMisses] = await Promise.all([
      this.prisma.costTracking.aggregate({
        where: { period: currentPeriod },
        _sum: { totalTokens: true, estimatedCostUsd: true },
      }),
      this.prisma.costTracking.aggregate({
        _sum: { totalTokens: true, estimatedCostUsd: true },
      }),
      this.redisGet('metrics:ai:cache:hits'),
      this.redisGet('metrics:ai:cache:misses'),
    ]);

    const documentsProcessed = await this.prisma.document.count({
      where: { status: DocumentStatus.READY },
    });

    const vectorsStored = await this.prisma.documentChunk.count();

    const hitsNum = parseInt(cacheHits ?? '0', 10);
    const missesNum = parseInt(cacheMisses ?? '0', 10);
    const total = hitsNum + missesNum;
    const cacheHitRatio = total > 0 ? Math.round((hitsNum / total) * 10000) / 100 : 0;

    // Estimate queries from token counts (~800 tokens average per query)
    const monthTokens = monthCost._sum.totalTokens ?? 0;
    const allTimeTokens = allTimeCost._sum.totalTokens ?? 0;
    const AVG_TOKENS_PER_QUERY = 800;

    return {
      totalQueries:    Math.round(monthTokens / AVG_TOKENS_PER_QUERY),
      allTimeQueries:  Math.round(allTimeTokens / AVG_TOKENS_PER_QUERY),
      totalCostUsd:    monthCost._sum.estimatedCostUsd ?? 0,
      cacheHitRatio,
      documentsProcessed,
      vectorsStored:   vectorsStored * 3, // ~3 vectors per chunk
    };
  }

  // ── Infrastructure cost estimation ────────────────────────────────────────
  private async getMonthlyInfrastructureCost(): Promise<number> {
    const totalUsers = await this.prisma.user.count();
    const perUserCost = totalUsers * 0.01;
    // Base multi-region infrastructure costs (USD/month)
    const baseCost = 900 * 3 + 850 + 600 + 200 + 150;
    return baseCost + perUserCost;
  }

  // ── Gross margin computation ──────────────────────────────────────────────
  private computeGrossMargin(
    customersByPlan: Record<string, number>,
    mrr: number,
    infraCost: number,
  ): number {
    if (mrr === 0) return 0;

    let aiCost = 0;
    Object.entries(customersByPlan).forEach(([plan, count]) => {
      aiCost += count * (COST_PER_TENANT[plan] ?? 0);
    });

    const cogs = infraCost + aiCost;
    const grossProfit = mrr - cogs;
    return Math.round((grossProfit / mrr) * 10000) / 100;
  }

  // ── CAC estimation ────────────────────────────────────────────────────────
  private async estimateCAC(periodStart: Date): Promise<number> {
    const estimatedMonthlyMarketingSpend = 5000;
    const newCustomers = await this.getNewOrgsThisMonth(periodStart);
    return newCustomers > 0
      ? Math.round(estimatedMonthlyMarketingSpend / newCustomers)
      : 0;
  }

  // ── Cohort analysis ───────────────────────────────────────────────────────
  async getCohortAnalysis(): Promise<CohortAnalysis[]> {
    const cached = await this.redisGet(this.CACHE_KEY_COHORTS);
    if (cached) return JSON.parse(cached);

    const cohorts = await this.computeCohortAnalysis();
    await this.redisSet(this.CACHE_KEY_COHORTS, JSON.stringify(cohorts), 3600);
    return cohorts;
  }

  private async computeCohortAnalysis(): Promise<CohortAnalysis[]> {
    const cohorts: CohortAnalysis[] = [];
    const monthsBack = 12;

    for (let i = monthsBack; i >= 1; i--) {
      const cohortDate = new Date();
      cohortDate.setMonth(cohortDate.getMonth() - i);
      const cohortStart = new Date(cohortDate.getFullYear(), cohortDate.getMonth(), 1);
      const cohortEnd = new Date(cohortDate.getFullYear(), cohortDate.getMonth() + 1, 0);

      // Use users who signed up in this cohort window
      const cohortUsers = await this.prisma.user.findMany({
        where: { createdAt: { gte: cohortStart, lte: cohortEnd } },
        select: { id: true },
      });

      const newUsers = cohortUsers.length;
      if (newUsers === 0) continue;

      const cohortMonthStr = `${cohortDate.getFullYear()}-${String(cohortDate.getMonth() + 1).padStart(2, '0')}`;

      const checkRetention = async (monthsAfter: number): Promise<number> => {
        if (i < monthsAfter) return 0;
        const checkDate = new Date(cohortStart);
        checkDate.setMonth(checkDate.getMonth() + monthsAfter);
        const userIds = cohortUsers.map(u => u.id);

        // Check who still has an active session in that window
        const retained = await this.prisma.session.count({
          where: {
            userId: { in: userIds },
            lastActiveAt: { gte: checkDate },
          },
        });
        return Math.round((retained / newUsers) * 100);
      };

      cohorts.push({
        cohortMonth: cohortMonthStr,
        newUsers,
        retained: {
          month1:  await checkRetention(1),
          month3:  await checkRetention(3),
          month6:  await checkRetention(6),
          month12: await checkRetention(12),
        },
        expansion: {
          month3: i >= 3 ? await this.getExpansionRate(cohortUsers.map(u => u.id), cohortStart, 3) : 0,
          month6: i >= 6 ? await this.getExpansionRate(cohortUsers.map(u => u.id), cohortStart, 6) : 0,
        },
      });
    }

    return cohorts;
  }

  private async getExpansionRate(
    userIds: string[],
    cohortStart: Date,
    monthsAfter: number,
  ): Promise<number> {
    if (userIds.length === 0) return 0;
    const checkDate = new Date(cohortStart);
    checkDate.setMonth(checkDate.getMonth() + monthsAfter);

    // Users who upgraded their subscription plan to PRO or above
    const upgraded = await this.prisma.user.count({
      where: {
        id: { in: userIds },
        subscriptionPlan: { not: SubscriptionPlan.FREE },
        updatedAt: { gte: cohortStart, lte: checkDate },
      },
    });

    return Math.round((upgraded / userIds.length) * 100);
  }

  // ── Background refresh ────────────────────────────────────────────────────
  async refreshMetricsCache(): Promise<void> {
    try {
      const metrics = await this.computeMetrics();
      await this.redisSet(
        this.CACHE_KEY_METRICS,
        JSON.stringify(metrics),
        this.CACHE_TTL_SECONDS,
      );
      this.logger.log(
        `Metrics refreshed: MRR=$${metrics.mrr} ARR=$${metrics.arr} Customers=${metrics.totalCustomers}`,
      );
    } catch (error) {
      this.logger.error('Failed to refresh metrics cache', error);
    }
  }
}
