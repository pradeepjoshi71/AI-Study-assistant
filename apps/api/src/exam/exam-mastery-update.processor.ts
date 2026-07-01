import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ConfigService } from '@nestjs/config';

/**
 * ExamMasteryUpdateProcessor
 *
 * Consumes 'exam-mastery-update' jobs dispatched by the FastAPI WeaknessDetector.
 *
 * Per classified topic:
 *  1. Load existing UserMastery (EMA = ongoing performance score).
 *  2. Compute weighted blend: newMastery = 0.4 × examScore + 0.6 × ongoingEMA
 *     - examScore is the normalized topic scorePercent (0-1 scale).
 *     - If no existing record, bootstrap with examScore alone.
 *  3. Upsert UserMastery with updated score + recalculated confidence.
 *  4. Invalidate Redis mastery cache for the user+topic key.
 *  5. For each CRITICAL or REVIEW topic: call FastAPI AdaptiveEngine
 *     (/ai/study/adaptive/recommend) with the exam score + topic difficulty,
 *     so Phase 3.2 recommendations are immediately triggered.
 */
@Processor('weakness-detection')
export class ExamMasteryUpdateProcessor extends WorkerHost {
  private readonly logger = new Logger(ExamMasteryUpdateProcessor.name);
  private readonly aiServiceUrl: string;

  // Blending weights
  private static readonly EXAM_WEIGHT     = 0.4;
  private static readonly ONGOING_WEIGHT  = 0.6;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly config: ConfigService,
  ) {
    super();
    this.aiServiceUrl = this.config.get<string>(
      'NEXT_PUBLIC_AI_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  async process(job: Job<any>): Promise<any> {
    if (job.name !== 'exam-mastery-update') return;

    const { attemptId, userId, examId, classifiedTopics } = job.data as {
      attemptId: string;
      userId: string;
      examId: string;
      classifiedTopics: Array<{
        topicId: string;
        score: number;          // 0-100
        classification: 'CRITICAL' | 'REVIEW' | 'MASTERED';
        recommendedAction: string;
      }>;
    };

    this.logger.log(
      `ExamMasteryUpdate: attempt=${attemptId} user=${userId} topics=${classifiedTopics.length}`,
    );

    const redis = this.redisService.getClient();
    const updateResults: Array<{
      topicId: string;
      newMastery: number;
      classification: string;
      adaptiveDifficulty?: number;
    }> = [];

    for (const topic of classifiedTopics) {
      const { topicId, score, classification } = topic;

      // Normalize exam score from percentage (0-100) → ratio (0-1)
      const examScore = Math.max(0, Math.min(1, score / 100));

      try {
        // ── 1. Load existing UserMastery (ongoing EMA) ──────────────────────
        const existing = await this.prisma.userMastery.findFirst({
          where: { userId, topicId },
        });

        // ── 2. Weighted blend ───────────────────────────────────────────────
        let newMastery: number;
        let newConfidence: number;

        if (existing) {
          const ongoingEma = Math.max(0, Math.min(1, existing.masteryScore));
          newMastery = Math.max(
            0,
            Math.min(
              1,
              ExamMasteryUpdateProcessor.EXAM_WEIGHT * examScore +
              ExamMasteryUpdateProcessor.ONGOING_WEIGHT * ongoingEma,
            ),
          );
          // Confidence grows with history; boost slightly after each exam
          newConfidence = Math.min(1.0, existing.confidence * 0.9 + 0.1);
        } else {
          // No history — bootstrap with exam score at low confidence
          newMastery    = examScore;
          newConfidence = 0.4;
        }

        newMastery    = Math.round(newMastery    * 10000) / 10000;
        newConfidence = Math.round(newConfidence * 10000) / 10000;

        // ── 3. Upsert UserMastery ───────────────────────────────────────────
        await this.prisma.userMastery.upsert({
          where: { userId_topicId: { userId, topicId } },
          create: { userId, topicId, masteryScore: newMastery, confidence: newConfidence },
          update: { masteryScore: newMastery, confidence: newConfidence },
        });

        // ── 4. Invalidate Redis mastery cache ───────────────────────────────
        const cacheKey = `user:${userId}:topic:${topicId}:mastery`;
        await redis.del(cacheKey).catch(() => null);

        this.logger.debug(
          `Mastery updated: user=${userId} topic=${topicId} ` +
          `mastery=${newMastery} confidence=${newConfidence} ` +
          `class=${classification}`,
        );

        // ── 5. Trigger AdaptiveEngine for weak topics ───────────────────────
        let adaptiveDifficulty: number | undefined;

        if (classification === 'CRITICAL' || classification === 'REVIEW') {
          adaptiveDifficulty = await this.triggerAdaptiveRecommendation(
            userId,
            topicId,
            examScore,
            newMastery,
          );
        }

        updateResults.push({ topicId, newMastery, classification, adaptiveDifficulty });
      } catch (err: any) {
        this.logger.warn(
          `Mastery update failed for user=${userId} topic=${topicId}: ${err.message}`,
        );
        updateResults.push({ topicId, newMastery: -1, classification });
      }
    }

    this.logger.log(
      `ExamMasteryUpdate complete: attempt=${attemptId} ` +
        `updated=${updateResults.filter((r) => r.newMastery >= 0).length}/${classifiedTopics.length}`,
    );

    return { success: true, attemptId, userId, results: updateResults };
  }

  // ── AdaptiveEngine call ─────────────────────────────────────────────────────

  private async triggerAdaptiveRecommendation(
    userId: string,
    topicId: string,
    examScore: number,   // 0-1
    masteryScore: number,
  ): Promise<number | undefined> {
    try {
      // Map masteryScore to an IRT difficulty estimate:
      // lower mastery → lower ability → easier recommended difficulty
      // θ range ≈ −3 to +3; we map 0-1 mastery → −1.5 to +1.5
      const irtDifficulty = masteryScore * 3.0 - 1.5;

      const res = await fetch(
        `${this.aiServiceUrl}/ai/study/adaptive/recommend`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            topicId,
            score:            examScore,
            itemDifficulty:   irtDifficulty,
            discrimination:   1.0,
            guessing:         0.2,
            recentScores:     [],
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!res.ok) {
        this.logger.warn(
          `AdaptiveEngine returned ${res.status} for user=${userId} topic=${topicId}`,
        );
        return undefined;
      }

      const data = await res.json() as { nextDifficulty?: number };
      this.logger.debug(
        `Adaptive recommendation: user=${userId} topic=${topicId} ` +
          `nextDifficulty=${data.nextDifficulty}`,
      );
      return data.nextDifficulty;
    } catch (err: any) {
      this.logger.warn(
        `AdaptiveEngine call failed for topic=${topicId}: ${err.message}`,
      );
      return undefined;
    }
  }
}
