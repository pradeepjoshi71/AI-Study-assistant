import {
  Controller,
  Get,
  Query,
  Req,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Roles } from "../../auth/decorators/roles.decorator";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../services/cache.service";

/** Valid metric names the BI cron writes */
const VALID_METRICS = [
  "dau",
  "retention_d1",
  "retention_d7",
  "retention_d30",
  "funnel",
] as const;

type MetricName = (typeof VALID_METRICS)[number];

/** Valid periods aligned with Prisma MetricPeriod enum */
const VALID_PERIODS = ["DAILY", "WEEKLY", "MONTHLY"] as const;
type PeriodName = (typeof VALID_PERIODS)[number];

interface MetricDataPoint {
  date: string;
  value: number;
  dimensions: Record<string, unknown>;
}

@ApiTags("Analytics Metrics")
@ApiBearerAuth()
@Controller("admin/analytics")
export class AnalyticsMetricsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /**
   * GET /admin/analytics/metrics
   *
   * Query latest MetricSnapshot rows. Reads Redis cache first (bi:{tenantId}:{metric}:{period}),
   * falls back to DB with the given day range.
   *
   * SUPER_ADMIN: may supply any tenantId filter.
   * ORG_ADMIN / others: tenantId is always scoped to their own tenant.
   */
  @Get("metrics")
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @ApiOperation({ summary: "Read BI MetricSnapshots for analytics dashboard" })
  @ApiQuery({ name: "metric", required: true, enum: VALID_METRICS })
  @ApiQuery({ name: "period", required: false, enum: VALID_PERIODS })
  @ApiQuery({ name: "days", required: false, type: Number })
  @ApiQuery({ name: "tenantId", required: false, type: String })
  async getMetrics(
    @Req() req: any,
    @Query("metric") metric: string,
    @Query("period") period: string = "DAILY",
    @Query("days") days: string = "30",
    @Query("tenantId") tenantIdParam?: string,
  ): Promise<{ metric: string; period: string; data: MetricDataPoint[] }> {
    // Validate metric
    if (!VALID_METRICS.includes(metric as MetricName)) {
      throw new BadRequestException(
        `Invalid metric. Allowed: ${VALID_METRICS.join(", ")}`,
      );
    }

    // Validate period
    const upperPeriod = period.toUpperCase() as PeriodName;
    if (!VALID_PERIODS.includes(upperPeriod)) {
      throw new BadRequestException(
        `Invalid period. Allowed: ${VALID_PERIODS.join(", ")}`,
      );
    }

    // Validate days
    const daysInt = parseInt(days, 10);
    if (isNaN(daysInt) || daysInt < 1 || daysInt > 365) {
      throw new BadRequestException("days must be 1–365");
    }

    // Tenant scoping
    const user = req.user;
    let tenantId: string;

    if (user?.role === UserRole.ADMIN) {
      if (!tenantIdParam) {
        // ADMIN without filter: aggregate across all tenants
        tenantId = "all";
      } else {
        tenantId = tenantIdParam;
      }
    } else {
      // Non-ADMIN must use their own tenant
      tenantId = req.tenantId;
      if (!tenantId) {
        throw new ForbiddenException("No tenant context for this request");
      }
      if (tenantIdParam && tenantIdParam !== tenantId) {
        throw new ForbiddenException("You can only view your own tenant metrics");
      }
    }

    // Try Redis cache first (single-tenant only)
    if (tenantId !== "all") {
      const cacheKey = `bi:${tenantId}:${metric}:${upperPeriod}`;
      try {
        const cached = await this.cache.get<any[]>(cacheKey);
        if (cached) {
          const data: MetricDataPoint[] = Array.isArray(cached)
            ? cached
            : [cached];
          return { metric, period: upperPeriod, data };
        }
      } catch {
        // Cache miss or parse error — fall through to DB
      }
    }

    // DB fallback
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - daysInt);

    const whereClause: Record<string, unknown> = {
      metric,
      period: upperPeriod,
      date: { gte: sinceDate },
    };

    if (tenantId !== "all") {
      whereClause.tenantId = tenantId;
    }

    const rows = await this.prisma.metricSnapshot.findMany({
      where: whereClause as any,
      orderBy: { date: "asc" },
      take: tenantId === "all" ? 500 : 365,
    });

    const data: MetricDataPoint[] = rows.map((row: any) => ({
      date: row.date.toISOString().split("T")[0],
      value: row.value,
      dimensions: (row.dimensions as Record<string, unknown>) ?? {},
      tenantId: row.tenantId,
    }));

    return { metric, period: upperPeriod, data };
  }

  /**
   * GET /admin/analytics/tenants
   * SUPER_ADMIN only — returns list of tenant IDs for the filter dropdown.
   */
  @Get("tenants")
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "List tenant IDs for analytics filter" })
  async listTenants() {
    const tenants = await this.prisma.tenant.findMany({
      select: { id: true, name: true, subdomain: true, status: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return { tenants };
  }
}
