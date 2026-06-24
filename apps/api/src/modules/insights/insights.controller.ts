import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { InsightsService } from './insights.service';

@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class InsightsController {
  constructor(private insightsService: InsightsService) {}

  @Get('recommendations')
  async getStudyRecommendations(@CurrentUser('id') userId: string) {
    const tenantId = userId;
    return this.insightsService.getStudyRecommendations(userId, tenantId);
  }
}
