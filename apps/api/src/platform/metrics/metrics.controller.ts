import {
  Controller, Get, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { MetricsService, PlatformMetrics, CohortAnalysis } from './metrics.service';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('platform/metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  // ── GET /platform/metrics/snapshot ───────────────────────────────────────
  @Get('snapshot')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async getSnapshot(): Promise<{ data: PlatformMetrics }> {
    const data = await this.metricsService.getPlatformMetrics();
    return { data };
  }

  // ── GET /platform/metrics/revenue ─────────────────────────────────────────
  @Get('revenue')
  @Roles(UserRole.ADMIN)
  async getRevenueMetrics(): Promise<{
    mrr: number;
    arr: number;
    mrrGrowthRate: number;
    arrGrowthRate: number;
    forecastedArr: number;
    calculatedAt: Date;
  }> {
    const snap = await this.metricsService.getPlatformMetrics();
    return {
      mrr: snap.mrr,
      arr: snap.arr,
      mrrGrowthRate: snap.mrrGrowthRate,
      arrGrowthRate: snap.arrGrowthRate,
      forecastedArr: Math.round(
        snap.mrr * Math.pow(1 + snap.mrrGrowthRate / 100, 12) * 12,
      ),
      calculatedAt: snap.calculatedAt,
    };
  }

  // ── GET /platform/metrics/customers ───────────────────────────────────────
  @Get('customers')
  @Roles(UserRole.ADMIN)
  async getCustomerMetrics(): Promise<{
    total: number;
    byPlan: Record<string, number>;
    netNew: number;
    churned: number;
    churnRate: number;
    ndr: number;
  }> {
    const snap = await this.metricsService.getPlatformMetrics();
    return {
      total: snap.totalCustomers,
      byPlan: snap.customersByPlan,
      netNew: snap.netNewCustomers,
      churned: snap.churnedThisMonth,
      churnRate: snap.churnRate,
      ndr: snap.ndr,
    };
  }

  // ── GET /platform/metrics/engagement ──────────────────────────────────────
  @Get('engagement')
  @Roles(UserRole.ADMIN)
  async getEngagementMetrics(): Promise<{
    dau: number;
    mau: number;
    dauMauRatio: number;
    totalAiQueries: number;
    aiQueriesThisMonth: number;
    documentsProcessed: number;
    vectorsStored: number;
  }> {
    const snap = await this.metricsService.getPlatformMetrics();
    return {
      dau: snap.dau,
      mau: snap.mau,
      dauMauRatio: snap.dauMauRatio,
      totalAiQueries: snap.totalAiQueries,
      aiQueriesThisMonth: snap.aiQueriesThisMonth,
      documentsProcessed: snap.documentsProcessed,
      vectorsStored: snap.vectorsStored,
    };
  }

  // ── GET /platform/metrics/unit-economics ──────────────────────────────────
  @Get('unit-economics')
  @Roles(UserRole.ADMIN)
  async getUnitEconomics(): Promise<{
    ltv: number;
    cac: number;
    ltvCacRatio: number;
    grossMargin: number;
    aiCostPerQuery: number;
    cacheHitRatio: number;
    monthlyInfrastructureCost: number;
    revenueToInfraRatio: number;
    revenuePerEmployee: number;
  }> {
    const snap = await this.metricsService.getPlatformMetrics();
    return {
      ltv: snap.ltv,
      cac: snap.cac,
      ltvCacRatio: snap.ltvCacRatio,
      grossMargin: snap.grossMargin,
      aiCostPerQuery: snap.aiCostPerQuery,
      cacheHitRatio: snap.cacheHitRatio,
      monthlyInfrastructureCost: snap.monthlyInfrastructureCost,
      revenueToInfraRatio: snap.revenueToInfraRatio,
      revenuePerEmployee: snap.revenuePerEmployee,
    };
  }

  // ── GET /platform/metrics/cohorts ─────────────────────────────────────────
  @Get('cohorts')
  @Roles(UserRole.ADMIN)
  async getCohortAnalysis(): Promise<{ data: CohortAnalysis[] }> {
    const data = await this.metricsService.getCohortAnalysis();
    return { data };
  }
}
