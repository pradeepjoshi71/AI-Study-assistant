import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';
import { LogSessionDto } from './analytics.types';

@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  @Get('dashboard')
  async getDashboardSummary(@CurrentUser('id') userId: string) {
    const tenantId = userId;
    return this.analyticsService.getDashboardSummary(userId, tenantId);
  }

  @Get('progress')
  async getProgressTimeline(@CurrentUser('id') userId: string) {
    const tenantId = userId;
    return this.analyticsService.getProgressTimeline(userId, tenantId);
  }

  @Get('mastery')
  async getTopicMastery(@CurrentUser('id') userId: string) {
    const tenantId = userId;
    return this.analyticsService.getTopicMastery(userId, tenantId);
  }

  @Post('event')
  async logStudyEvent(
    @Body() dto: LogSessionDto,
    @CurrentUser('id') userId: string,
  ) {
    const tenantId = userId;
    return this.analyticsService.logSession(userId, tenantId, dto);
  }
}
