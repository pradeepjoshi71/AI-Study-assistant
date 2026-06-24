import { Controller, Post, Body, UseGuards } from '@nestjs/common';
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
}
