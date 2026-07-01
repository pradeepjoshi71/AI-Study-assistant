import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ExamService } from './exam.service';
import { CreateExamDto } from './dto/create-exam.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('exams')
export class ExamController {
  constructor(private readonly examService: ExamService) {}

  /**
   * POST /exams
   * Validates config, creates Exam (DRAFT), dispatches generation job.
   */
  @Post()
  async create(
    @Body() dto: CreateExamDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.examService.create(dto, userId);
  }

  /**
   * GET /exams
   * Returns all exams for the caller's organization.
   */
  @Get()
  async findAll() {
    return this.examService.findAll();
  }

  /**
   * GET /exams/:id
   * Returns a single exam with its questions (once READY).
   */
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.examService.findOne(id, userId);
  }

  /**
   * GET /exams/:id/status
   * Returns current generation status + question count.
   */
  @Get(':id/status')
  async getStatus(@Param('id') id: string) {
    return this.examService.getStatus(id);
  }

  /**
   * POST /exams/attempts/:attemptId/score
   * Triggers FastAPI scoring pipeline for a submitted attempt.
   * Idempotent — re-calling on an already-scored attempt returns the cached result.
   */
  @Post('attempts/:attemptId/score')
  async scoreAttempt(
    @Param('attemptId') attemptId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.examService.scoreAttempt(attemptId, userId);
  }
}
