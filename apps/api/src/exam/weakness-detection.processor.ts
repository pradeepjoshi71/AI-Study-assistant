import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

/**
 * WeaknessDetectionProcessor
 *
 * Consumes 'detect-weakness' jobs (dispatched by FastAPI exam_scorer after
 * every submitted attempt).
 *
 * Responsibilities:
 *  1. Load the ExamResult to confirm weakTopics.
 *  2. Load UserMastery records for each weak topic.
 *  3. Dampen mastery scores (× 0.85) for confirmed weak topics.
 *  4. Emit structured log for downstream analytics / study plan rescheduler.
 *
 * Future: trigger adaptive study-plan recommendations here.
 */
@Processor('weakness-detection')
export class WeaknessDetectionProcessor extends WorkerHost {
  private readonly logger = new Logger(WeaknessDetectionProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<any>): Promise<any> {
    if (job.name !== 'detect-weakness') return;

    const { attemptId, examId, weakTopics } = job.data as {
      attemptId: string;
      examId: string;
      weakTopics: string[];
    };

    this.logger.log(
      `Weakness detection: attempt=${attemptId} weakTopics=${weakTopics.join(',')}`,
    );

    if (!weakTopics || weakTopics.length === 0) {
      this.logger.log(`No weak topics for attempt=${attemptId} — nothing to do`);
      return { success: true, weakTopics: [] };
    }

    try {
      // ── 1. Load ExamResult for confirmation ──────────────────────────────
      const result = await this.prisma.examResult.findUnique({
        where: { attemptId },
        select: { weakTopics: true, topicBreakdown: true },
      });

      const confirmedWeak: string[] =
        result?.weakTopics ?? weakTopics;

      if (confirmedWeak.length === 0) {
        return { success: true, weakTopics: [] };
      }

      // ── 2. Load the attempt to get userId ────────────────────────────────
      const attempt = await this.prisma.examAttempt.findUnique({
        where: { id: attemptId },
        select: { userId: true },
      });

      if (!attempt) {
        this.logger.warn(`ExamAttempt not found: ${attemptId}`);
        return { success: false, error: 'Attempt not found' };
      }

      const { userId } = attempt;

      // ── 3. Dampen UserMastery for each weak topic (× 0.85 floor 0) ──────
      const dampenResults: { topicId: string; newScore: number | null }[] = [];

      for (const topicId of confirmedWeak) {
      try {
          const mastery = await this.prisma.userMastery.findFirst({
            where: { userId, topicId },
          });

          let newScore: number;
          if (mastery) {
            newScore = Math.max(0, mastery.masteryScore * 0.85);
            await this.prisma.userMastery.update({
              where: { id: mastery.id },
              data: { masteryScore: newScore },
            });
          } else {
            newScore = 0.2;
            // Use upsert to safely handle the unique(userId, topicId) constraint
            await this.prisma.userMastery.upsert({
              where: { userId_topicId: { userId, topicId } },
              update: { masteryScore: newScore },
              create: {
                userId,
                topicId,
                masteryScore: newScore,
                confidence: 0.3,   // low confidence on first exam failure
              },
            });
          }
          dampenResults.push({ topicId, newScore: Math.round(newScore * 1000) / 1000 });
        } catch (err: any) {
          this.logger.warn(
            `Could not update mastery for user=${userId} topic=${topicId}: ${err.message}`,
          );
          dampenResults.push({ topicId, newScore: null });
        }
      }

      this.logger.log(
        `Weakness detection complete: user=${userId} attempt=${attemptId} ` +
          `dampened=${JSON.stringify(dampenResults)}`,
      );

      return { success: true, userId, attemptId, dampened: dampenResults };
    } catch (err: any) {
      this.logger.error(
        `WeaknessDetectionProcessor failed for attempt=${attemptId}: ${err.message}`,
      );
      throw err; // let BullMQ retry
    }
  }
}
