import { Controller, Post, Body, UseGuards, Get, Put, Param } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { StudyModeService, GenerateStudyModeDto } from './study-mode.service';

@UseGuards(JwtAuthGuard)
@Controller('study')
export class StudyModeController {
  constructor(private studyModeService: StudyModeService) {}

  @Post('mode/generate')
  async generateStudyContent(
    @Body() dto: GenerateStudyModeDto,
    @CurrentUser('id') userId: string,
  ) {
    const tenantId = userId; // tenant isolation fallback
    return this.studyModeService.generateStudyContent(userId, tenantId, dto);
  }

  @Get('adaptive/summary')
  async getAdaptiveSummary(@CurrentUser('id') userId: string) {
    return this.studyModeService.getAdaptiveSummary(userId);
  }

  @Get('adaptive/session')
  async getAdaptiveSession(@CurrentUser('id') userId: string) {
    return this.studyModeService.getOrCreateAdaptiveSession(userId);
  }

  @Put('adaptive/session/:id/answer')
  async submitAdaptiveAnswer(
    @Param('id') sessionId: string,
    @Body() dto: { itemId: string; score: number; difficulty: number; topicId: string },
    @CurrentUser('id') userId: string,
  ) {
    return this.studyModeService.submitAdaptiveAnswer(userId, sessionId, dto);
  }
}
