import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { userContextStorage } from '../common/context/user-context';
import { CreateExamDto } from './dto/create-exam.dto';
import { ExamStatus } from '@prisma/client';

@Injectable()
export class ExamService {
  private readonly logger = new Logger(ExamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue('exam-generation') private readonly examQueue: Queue,
  ) {}

  // ── Validation helpers ────────────────────────────────────────────────────

  private validateDifficultyMix(dto: CreateExamDto): void {
    const { easy, medium, hard } = dto.difficultyMix;
    const total = easy + medium + hard;
    if (Math.abs(total - 100) > 0.01) {
      throw new BadRequestException(
        `difficultyMix percentages must sum to 100 (got ${total})`,
      );
    }
    if (easy < 0 || medium < 0 || hard < 0) {
      throw new BadRequestException('difficultyMix percentages must be non-negative');
    }
  }

  // ── Core methods ──────────────────────────────────────────────────────────

  async create(dto: CreateExamDto, userId: string) {
    this.validateDifficultyMix(dto);

    const orgId = userContextStorage.getStore()?.orgId;
    if (!orgId) {
      throw new ForbiddenException('Exam creation requires an organization context');
    }

    // Validate org exists
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');

    // Estimate difficulty as weighted average
    const { easy, medium, hard } = dto.difficultyMix;
    const difficulty = (easy * 0.25 + medium * 0.5 + hard * 1.0) / 100;

    const exam = await this.prisma.exam.create({
      data: {
        orgId,
        createdBy: userId,
        title: dto.title,
        docIds: dto.docIds,
        topicIds: dto.topicIds,
        totalQuestions: dto.totalQuestions,
        durationMinutes: dto.durationMinutes,
        difficulty,
        type: dto.type as any,
        status: ExamStatus.DRAFT,
      },
    });

    this.logger.log(`Exam created: id=${exam.id} org=${orgId} user=${userId}`);

    // Dispatch BullMQ job — FastAPI will pick this up and generate questions
    try {
      await this.examQueue.add(
        'generate-exam',
        {
          examId: exam.id,
          orgId,
          createdBy: userId,
          docIds: dto.docIds,
          topicIds: dto.topicIds,
          totalQuestions: dto.totalQuestions,
          durationMinutes: dto.durationMinutes,
          difficultyMix: dto.difficultyMix,
          questionTypes: dto.questionTypes,
          type: dto.type,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );
      this.logger.log(`Dispatched exam-generation job for exam=${exam.id}`);
    } catch (err: any) {
      this.logger.error(`Failed to enqueue exam-generation job: ${err.message}`);
      // Don't fail the request — job can be re-triggered
    }

    return exam;
  }

  async findOne(examId: string, userId: string) {
    const orgId = userContextStorage.getStore()?.orgId;
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: { questions: true },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    if (orgId && exam.orgId !== orgId) {
      throw new ForbiddenException('Access denied');
    }
    return exam;
  }

  async findAll() {
    const orgId = userContextStorage.getStore()?.orgId;
    if (!orgId) throw new ForbiddenException('Organization context required');
    return this.prisma.exam.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getStatus(examId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      select: { id: true, status: true, title: true, totalQuestions: true },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    const questionCount = await this.prisma.examQuestion.count({
      where: { examId },
    });
    return { ...exam, questionCount };
  }

  async scoreAttempt(attemptId: string, userId: string): Promise<any> {
    // Verify the attempt belongs to the calling user
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { id: attemptId },
      select: { userId: true, status: true },
    });
    if (!attempt) throw new NotFoundException('ExamAttempt not found');
    if (attempt.userId !== userId) throw new ForbiddenException('Access denied');

    // Idempotent — if already scored, return cached result
    if (attempt.status === 'SUBMITTED') {
      return this.prisma.examResult.findUnique({ where: { attemptId } });
    }

    const aiServiceUrl = this.config.get<string>(
      'NEXT_PUBLIC_AI_SERVICE_URL',
      'http://localhost:8000',
    );

    this.logger.log(`Calling FastAPI scorer for attempt=${attemptId}`);
    const res = await fetch(`${aiServiceUrl}/ai/exam/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attemptId }),
      signal: AbortSignal.timeout(120_000), // 2 min
    });

    if (!res.ok) {
      const errText = await res.text();
      this.logger.error(`FastAPI scorer returned ${res.status}: ${errText}`);
      throw new BadRequestException(`Scoring failed: ${errText}`);
    }

    return res.json();
  }
}
