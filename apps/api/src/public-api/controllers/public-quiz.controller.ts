import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
  UseFilters,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../api-key/guards/api-key.guard';
import { ApiKeyCtx, ApiKeyContext } from '../../api-key/decorators/api-key-context.decorator';
import { Scopes } from '../../api-key/decorators/scopes.decorator';
import { QuizService } from '../../modules/quiz/quiz.service';
import { GenerateQuizDto, SubmitQuizDto } from '../../modules/quiz/quiz.types';
import { envelope } from '../common/envelope';
import { PublicApiExceptionFilter } from '../common/public-api-exception.filter';

import { RequiresFeature } from "../../common/guards/tenant-feature.guard";

@ApiTags('Public Quiz')
@ApiBearerAuth('bearer')
@UseGuards(ApiKeyGuard)
@UseFilters(PublicApiExceptionFilter)
@Controller({ path: 'api/public/v1/quizzes', version: VERSION_NEUTRAL })
@RequiresFeature("api_access")
export class PublicQuizController {
  constructor(private readonly quizService: QuizService) {}

  /**
   * GET /api/public/v1/quizzes
   * List quizzes for the org.
   * Scopes: quiz:read
   */
  @Get()
  @Scopes('quiz:read')
  @ApiOperation({ summary: 'List quizzes', description: 'Retrieve a list of generated study quizzes for the organization.' })
  @ApiResponse({ status: 200, description: 'Quizzes retrieved successfully.' })
  async list(@Req() req: Request, @ApiKeyCtx() ctx: ApiKeyContext) {
    const userId = ctx.userId ?? ctx.orgId;
    const quizzes = await this.quizService.listQuizzes(userId, ctx.orgId);

    return envelope(
      quizzes.map((q) => ({
        id: q.id,
        title: q.title,
        difficulty: q.difficulty,
        createdAt: q.createdAt,
      })),
      req,
    );
  }

  /**
   * POST /api/public/v1/quizzes/generate
   * Generate a quiz from a document/conversation context.
   * Scopes: quiz:write
   */
  @Post('generate')
  @Scopes('quiz:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate quiz', description: 'Generate a new automated study quiz from organization documents or chat context.' })
  @ApiResponse({ status: 201, description: 'Quiz generated successfully.' })
  async generate(
    @Req() req: Request,
    @Body() dto: GenerateQuizDto,
    @ApiKeyCtx() ctx: ApiKeyContext,
  ) {
    const userId = ctx.userId ?? ctx.orgId;
    const quiz = await this.quizService.generateQuiz(userId, ctx.orgId, dto);

    return envelope(
      {
        id: quiz.id,
        title: quiz.title,
        difficulty: quiz.difficulty,
        questions: quiz.questions.map((q) => ({
          id: q.id,
          type: q.type,
          question: q.question,
          options: q.options,
          // answer and explanation intentionally excluded from generation response
        })),
        createdAt: quiz.createdAt,
      },
      req,
    );
  }

  /**
   * GET /api/public/v1/quizzes/:id
   * Fetch quiz by UUID.
   * Scopes: quiz:read
   */
  @Get(':id')
  @Scopes('quiz:read')
  @ApiOperation({ summary: 'Get quiz by ID', description: 'Retrieve questions and answers of a specific study quiz.' })
  @ApiResponse({ status: 200, description: 'Quiz retrieved successfully.' })
  async getOne(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @ApiKeyCtx() ctx: ApiKeyContext,
  ) {
    const userId = ctx.userId ?? ctx.orgId;
    const quiz = await this.quizService.getQuiz(userId, ctx.orgId, id);

    return envelope(
      {
        id: quiz.id,
        title: quiz.title,
        difficulty: quiz.difficulty,
        questions: quiz.questions.map((q) => ({
          id: q.id,
          type: q.type,
          question: q.question,
          options: q.options,
          answer: q.answer,
          explanation: q.explanation,
        })),
        createdAt: quiz.createdAt,
      },
      req,
    );
  }

  /**
   * POST /api/public/v1/quizzes/:id/submit
   * Submit answers and receive analytics-backed score.
   * Scopes: quiz:write
   */
  @Post(':id/submit')
  @Scopes('quiz:write')
  @ApiOperation({ summary: 'Submit quiz answers', description: 'Submit quiz responses to receive a graded score and trigger adaptive mastery adjustments.' })
  @ApiResponse({ status: 200, description: 'Quiz responses submitted and graded successfully.' })
  async submit(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitQuizDto,
    @ApiKeyCtx() ctx: ApiKeyContext,
  ) {
    const userId = ctx.userId ?? ctx.orgId;
    const result = await this.quizService.submitQuiz(userId, ctx.orgId, id, dto);

    return envelope(
      {
        attemptId: result.id,
        score: result.score,
        correctAnswers: result.correctAnswers,
        wrongAnswers: result.wrongAnswers,
        completedAt: result.createdAt,
      },
      req,
    );
  }
}
