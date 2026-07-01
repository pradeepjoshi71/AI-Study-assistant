import { Controller, Get, UseGuards, UseFilters, Req } from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiKeyOrJwtAuthGuard } from '../guards/api-key-or-jwt.guard';
import { ApiKeyCtx, ApiKeyContext } from '../../api-key/decorators/api-key-context.decorator';
import { Scopes } from '../../api-key/decorators/scopes.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { envelope } from '../common/envelope';
import { PublicApiExceptionFilter } from '../common/public-api-exception.filter';
import { VERSION_NEUTRAL } from '@nestjs/common';

import { RequiresFeature } from "../../common/guards/tenant-feature.guard";

@ApiTags('Public Usage')
@ApiBearerAuth('bearer')
@UseGuards(ApiKeyOrJwtAuthGuard)
@UseFilters(PublicApiExceptionFilter)
@Controller({ path: 'api/public/v1/usage', version: VERSION_NEUTRAL })
@RequiresFeature("api_access")
export class PublicUsageController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('stats')
  @Scopes('analytics:read')
  @ApiOperation({ summary: 'Get usage stats', description: 'Retrieve requests per day, error rate, and average latency over the last 30 days.' })
  @ApiResponse({ status: 200, description: 'Usage statistics retrieved successfully.' })
  async getUsageStats(@Req() req: Request, @ApiKeyCtx() ctx: ApiKeyContext) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 1. Fetch all API keys for this organization
    const apiKeys = await this.prisma.apiKey.findMany({
      where: { organizationId: ctx.orgId },
      select: { id: true },
    });

    const keyIds = apiKeys.map((k) => k.id);

    if (keyIds.length === 0) {
      return envelope({
        requests: [],
        errorRate: 0,
        avgLatency: 0,
      }, req);
    }

    // 2. Fetch usages from APIKeyUsage logs
    const usages = await this.prisma.aPIKeyUsage.findMany({
      where: {
        keyId: { in: keyIds },
        createdAt: { gte: thirtyDaysAgo },
      },
      orderBy: { createdAt: 'asc' },
    });

    // 3. Process usage analytics data
    const totalRequests = usages.length;
    let errorRequests = 0;
    let totalLatency = 0;

    // Group by day (YYYY-MM-DD)
    const dayMap = new Map<string, number>();
    // Pre-populate last 30 days with 0 requests
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      dayMap.set(dateStr, 0);
    }

    for (const u of usages) {
      const dateStr = u.createdAt.toISOString().split('T')[0];
      if (dayMap.has(dateStr)) {
        dayMap.set(dateStr, dayMap.get(dateStr)! + 1);
      } else {
        // Fallback for edge cases outside the pre-populated range
        dayMap.set(dateStr, 1);
      }

      if (u.statusCode >= 400) {
        errorRequests++;
      }
      totalLatency += u.latencyMs;
    }

    const requests = Array.from(dayMap.entries()).map(([date, count]) => ({
      date,
      count,
    })).sort((a, b) => a.date.localeCompare(b.date));

    const errorRate = totalRequests > 0 ? (errorRequests / totalRequests) * 100 : 0;
    const avgLatency = totalRequests > 0 ? totalLatency / totalRequests : 0;

    return envelope({
      requests,
      errorRate: parseFloat(errorRate.toFixed(2)),
      avgLatency: Math.round(avgLatency),
    }, req);
  }
}
