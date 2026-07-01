import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ExamStatus } from '@prisma/client';

function resolveAiUrl(url: string): string {
  // In Docker environments, rewrite localhost → host.docker.internal
  return url.replace('localhost', 'host.docker.internal');
}

@Processor('exam-generation')
export class ExamGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(ExamGenerationProcessor.name);
  private readonly aiServiceUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    super();
    this.aiServiceUrl = this.config.get<string>(
      'NEXT_PUBLIC_AI_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  async process(job: Job<any>): Promise<any> {
    if (job.name !== 'generate-exam') return;

    const {
      examId,
      orgId,
      createdBy,
      docIds,
      topicIds,
      totalQuestions,
      durationMinutes,
      difficultyMix,
      questionTypes,
      type,
    } = job.data;

    this.logger.log(`Processing exam generation job=${job.id} exam=${examId}`);

    try {
      // Call FastAPI /exam/generate
      const response = await fetch(
        `${resolveAiUrl(this.aiServiceUrl)}/ai/exam/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            examId,
            orgId,
            createdBy,
            docIds,
            topicIds,
            totalQuestions,
            durationMinutes,
            difficultyMix,
            questionTypes,
            type,
          }),
          signal: AbortSignal.timeout(300_000), // 5 min timeout for large exams
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(
          `FastAPI /exam/generate returned ${response.status}: ${errText}`,
        );
      }

      const result = await response.json();
      this.logger.log(
        `Exam ${examId} generation complete: ${result.questionCount} questions stored`,
      );
      return { success: true, examId, questionCount: result.questionCount };
    } catch (err: any) {
      this.logger.error(
        `Exam generation failed for exam=${examId}: ${err.message}`,
      );
      // Mark exam status DRAFT on failure (not ARCHIVED — stays retryable)
      await this.prisma.exam
        .update({
          where: { id: examId },
          data: { status: ExamStatus.DRAFT },
        })
        .catch(() => null);
      throw err; // re-throw so BullMQ retries per job options
    }
  }
}
