import {
  Controller,
  Get,
  Req,
  UseGuards,
  UseFilters,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../api-key/guards/api-key.guard';
import { ApiKeyCtx, ApiKeyContext } from '../../api-key/decorators/api-key-context.decorator';
import { Scopes } from '../../api-key/decorators/scopes.decorator';
import { AnalyticsService } from '../../modules/analytics/analytics.service';
import { envelope } from '../common/envelope';
import { PublicApiExceptionFilter } from '../common/public-api-exception.filter';

import { RequiresFeature } from "../../common/guards/tenant-feature.guard";

@ApiTags('Public Progress')
@ApiBearerAuth('bearer')
@UseGuards(ApiKeyGuard)
@UseFilters(PublicApiExceptionFilter)
@Controller({ path: 'api/public/v1/progress', version: VERSION_NEUTRAL })
@RequiresFeature("api_access")
export class PublicProgressController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * GET /api/public/v1/progress/summary
   * Aggregated learning summary: study time, quiz counts, streaks, top mastery topics.
   * Scopes: progress:read
   */
  @Get('summary')
  @Scopes('progress:read')
  @ApiOperation({ summary: 'Get progress summary', description: 'Retrieve high-level study statistics, study durations, quiz attempt counts, and current streak days.' })
  @ApiResponse({ status: 200, description: 'Summary statistics retrieved successfully.' })
  async summary(@Req() req: Request, @ApiKeyCtx() ctx: ApiKeyContext) {
    const userId = ctx.userId ?? ctx.orgId;
    const tenantId = ctx.orgId;

    const data = await this.analyticsService.getDashboardSummary(userId, tenantId);

    return envelope(data, req);
  }

  /**
   * GET /api/public/v1/progress/mastery
   * Per-topic mastery scores ordered by descending score.
   * Scopes: progress:read
   */
  @Get('mastery')
  @Scopes('progress:read')
  @ApiOperation({ summary: 'Get topic mastery', description: 'Retrieve a list of mastery scores and classification levels grouped by topic.' })
  @ApiResponse({ status: 200, description: 'Topic mastery scores retrieved successfully.' })
  async mastery(@Req() req: Request, @ApiKeyCtx() ctx: ApiKeyContext) {
    const userId = ctx.userId ?? ctx.orgId;
    const tenantId = ctx.orgId;

    const masteries = await this.analyticsService.getTopicMastery(userId, tenantId);

    return envelope(
      masteries.map((m) => ({
        id: m.id,
        topic: m.topic,
        score: Math.round(m.score),
        level: m.score >= 80 ? 'strong' : m.score >= 50 ? 'medium' : 'weak',
        updatedAt: m.updatedAt,
      })),
      req,
    );
  }

  /**
   * GET /api/public/v1/progress/timeline
   * 14-day activity breakdown (study time, quizzes, flashcards per day).
   * Scopes: progress:read
   */
  @Get('timeline')
  @Scopes('progress:read')
  @ApiOperation({ summary: 'Get 14-day study timeline', description: 'Retrieve day-by-day aggregates of flashcard reviews, quizzes taken, and total study duration over the last 14 days.' })
  @ApiResponse({ status: 200, description: 'Progress timeline retrieved successfully.' })
  async timeline(@Req() req: Request, @ApiKeyCtx() ctx: ApiKeyContext) {
    const userId = ctx.userId ?? ctx.orgId;
    const tenantId = ctx.orgId;

    const data = await this.analyticsService.getProgressTimeline(userId, tenantId);

    return envelope(data, req);
  }
}
