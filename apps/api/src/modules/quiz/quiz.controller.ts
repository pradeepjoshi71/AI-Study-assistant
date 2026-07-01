import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { QuizService } from './quiz.service';
import { GenerateQuizDto, SubmitQuizDto } from './quiz.types';
import { Track } from '../../common/decorators/track.decorator';

@UseGuards(JwtAuthGuard)
@Controller('study')
export class QuizController {
  constructor(private quizService: QuizService) {}

  @Post('quiz/generate')
  async generateQuiz(
    @Body() dto: GenerateQuizDto,
    @CurrentUser('id') userId: string,
  ) {
    const tenantId = userId; // tenant isolation fallback
    return this.quizService.generateQuiz(userId, tenantId, dto);
  }

  @Post('quiz/:id/submit')
  @Track('quiz.submit')
  async submitQuiz(
    @Param('id') quizId: string,
    @Body() dto: SubmitQuizDto,
    @CurrentUser('id') userId: string,
  ) {
    const tenantId = userId;
    return this.quizService.submitQuiz(userId, tenantId, quizId, dto);
  }

  @Get('quiz/:id')
  async getQuiz(
    @Param('id') quizId: string,
    @CurrentUser('id') userId: string,
  ) {
    const tenantId = userId;
    return this.quizService.getQuiz(userId, tenantId, quizId);
  }

  @Get('quizzes')
  async listQuizzes(@CurrentUser('id') userId: string) {
    const tenantId = userId;
    return this.quizService.listQuizzes(userId, tenantId);
  }
}
