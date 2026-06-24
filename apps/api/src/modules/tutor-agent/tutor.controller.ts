import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { TutorService } from './tutor.service';
import { GeneratePlanDto, CompleteTaskDto } from './tutor.types';

@UseGuards(JwtAuthGuard)
@Controller('tutor')
export class TutorController {
  constructor(private tutorService: TutorService) {}

  @Get('plan/current')
  async getCurrentPlan(@CurrentUser('id') userId: string) {
    const tenantId = userId;
    return this.tutorService.getCurrentPlan(userId, tenantId);
  }

  @Post('plan/generate')
  async generateWeeklyPlan(
    @Body() dto: GeneratePlanDto,
    @CurrentUser('id') userId: string,
  ) {
    const tenantId = userId;
    return this.tutorService.generateWeeklyPlan(userId, tenantId, dto);
  }

  @Post('task/:id/complete')
  async completeTask(
    @Param('id') taskId: string,
    @Body() dto: CompleteTaskDto,
    @CurrentUser('id') userId: string,
  ) {
    const tenantId = userId;
    return this.tutorService.completeTask(userId, tenantId, taskId, dto);
  }

  @Get('recommendations')
  async getRecommendations(@CurrentUser('id') userId: string) {
    const tenantId = userId;
    return this.tutorService.getRecommendations(userId, tenantId);
  }
}
