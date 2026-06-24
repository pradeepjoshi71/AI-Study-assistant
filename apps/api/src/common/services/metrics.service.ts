import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Cost per 1,000 tokens in USD — Gemini 1.5 Flash pricing (input+output blended) */
const COST_PER_1K_TOKENS_USD = 0.0000035;

export interface RecordUsageDto {
  userId: string;
  tenantId: string;
  endpoint: string;     // e.g. "chat.send", "quiz.generate"
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  cacheHit?: boolean;
  model?: string;
}

export interface UsageSummary {
  period: string;
  totalRequests: number;
  totalTokens: number;
  estimatedCostUsd: number;
  avgLatencyMs: number;
  cacheHitRate: number;
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records a single request's usage metrics.
   * Fire-and-forget — never throws, never blocks the request path.
   */
  recordUsage(dto: RecordUsageDto): void {
    const {
      userId, tenantId, endpoint,
      tokensIn = 0, tokensOut = 0,
      latencyMs = 0, cacheHit = false,
      model,
    } = dto;

    const totalTokens = tokensIn + tokensOut;

    // Write UsageMetric row
    this.prisma.usageMetric
      .create({
        data: { userId, tenantId, endpoint, tokensIn, tokensOut, latencyMs, cacheHit, model },
      })
      .catch((err) => this.logger.warn(`UsageMetric write failed: ${err.message}`));

    // Update monthly cost ledger (upsert)
    if (totalTokens > 0) {
      this._updateCostTracking(userId, tenantId, totalTokens).catch((err) =>
        this.logger.warn(`CostTracking update failed: ${err.message}`),
      );
    }
  }

  /**
   * Returns a usage summary for a given tenant and billing period (YYYY-MM).
   */
  async getUsageSummary(tenantId: string, period: string): Promise<UsageSummary> {
    // Parse period to date range
    const [year, month] = period.split('-').map(Number);
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 1);

    const metrics = await this.prisma.usageMetric.findMany({
      where: { tenantId, createdAt: { gte: from, lt: to } },
      select: { tokensIn: true, tokensOut: true, latencyMs: true, cacheHit: true },
    });

    const totalRequests = metrics.length;
    const totalTokens = metrics.reduce((s, m) => s + m.tokensIn + m.tokensOut, 0);
    const totalLatency = metrics.reduce((s, m) => s + m.latencyMs, 0);
    const cacheHits = metrics.filter((m) => m.cacheHit).length;

    return {
      period,
      totalRequests,
      totalTokens,
      estimatedCostUsd: (totalTokens / 1000) * COST_PER_1K_TOKENS_USD,
      avgLatencyMs: totalRequests > 0 ? Math.round(totalLatency / totalRequests) : 0,
      cacheHitRate: totalRequests > 0 ? Math.round((cacheHits / totalRequests) * 100) : 0,
    };
  }

  private async _updateCostTracking(
    userId: string,
    tenantId: string,
    tokens: number,
  ): Promise<void> {
    const period = new Date().toISOString().slice(0, 7); // "YYYY-MM"
    const costDelta = (tokens / 1000) * COST_PER_1K_TOKENS_USD;

    await this.prisma.costTracking.upsert({
      where: { tenantId_userId_period: { tenantId, userId, period } },
      create: { tenantId, userId, period, totalTokens: tokens, estimatedCostUsd: costDelta },
      update: {
        totalTokens: { increment: tokens },
        estimatedCostUsd: { increment: costDelta },
      },
    });
  }
}

