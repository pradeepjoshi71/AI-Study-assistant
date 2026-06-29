import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

@Processor("adaptive-mastery")
export class AdaptiveMasteryProcessor extends WorkerHost {
  private readonly logger = new Logger(AdaptiveMasteryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { userId, orgId, itemId, itemType, score, timeTakenMs, attemptNumber, difficulty } = job.data;
    if (!userId || !itemId || !itemType) {
      this.logger.error(`Job ${job.id} missing adaptive performance parameters.`);
      return { success: false, error: "Missing parameters" };
    }

    this.logger.log(`Processing performance and mastery update for user: ${userId} (${itemType}: ${itemId})`);

    try {
      // 1. Write the PerformanceRecord
      const record = await this.prisma.performanceRecord.create({
        data: {
          userId,
          orgId,
          itemId,
          itemType, // QUIZ | FLASHCARD
          score: parseFloat(score),
          timeTakenMs: parseInt(timeTakenMs),
          attemptNumber: parseInt(attemptNumber),
          difficulty: parseFloat(difficulty),
        },
      });

      // 2. Determine target topic based on item type
      let topicId: string | null = null;

      if (itemType === "QUIZ") {
        // Resolve topic hierarchy or document tags from Quiz questions source chunks
        const question = await this.prisma.quizQuestion.findFirst({
          where: { quizId: itemId },
        });
        if (question && question.chunkIdSource) {
          // Resolve topic mapped to document chunk or default to a topic matching the quiz title
          const topic = await this.prisma.topic.findFirst({
            where: { docId: question.chunkIdSource },
          });
          if (topic) topicId = topic.id;
        }

        if (!topicId) {
          const quiz = await this.prisma.quiz.findUnique({ where: { id: itemId } });
          if (quiz) {
            const cleanTitle = quiz.title.replace("Quiz: ", "").trim();
            const topic = await this.prisma.topic.findFirst({ where: { name: cleanTitle } });
            if (topic) {
              topicId = topic.id;
            } else {
              const newTopic = await this.prisma.topic.create({ data: { name: cleanTitle } });
              topicId = newTopic.id;
            }
          }
        }
      } else if (itemType === "FLASHCARD") {
        const card = await this.prisma.flashcard.findUnique({
          where: { id: itemId },
          include: { deck: true },
        });
        if (card) {
          const tags = (card.tags as string[]) || [];
          const tagName = tags[0] || card.deck.title.replace("Deck: ", "").trim();
          const topic = await this.prisma.topic.findFirst({ where: { name: tagName } });
          if (topic) {
            topicId = topic.id;
          } else {
            const newTopic = await this.prisma.topic.create({ data: { name: tagName } });
            topicId = newTopic.id;
          }
        }
      }

      if (!topicId) {
        this.logger.warn(`Could not resolve topic for PerformanceRecord: ${record.id}`);
        return { success: true, recordId: record.id, warning: "Topic not resolved" };
      }

      // 3. Aggregate last 10 records for this topic
      const recentRecords = await this.prisma.performanceRecord.findMany({
        where: {
          userId,
          // Since records only have itemId, we select recent records matching the active item type and user
          itemType,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      // Calculate Exponential Moving Average (EMA) with alpha=0.3
      // Formula: EMA_t = alpha * score_t + (1 - alpha) * EMA_{t-1}
      // For scores, we normalize percentages (0-100) or raw bounds to a 0-1 scale.
      const alpha = 0.3;
      let masteryScore = 0.5; // Start default middle value anchor

      // Apply EMA in chronological order (reverse the take 10 query list)
      const chronoRecords = [...recentRecords].reverse();
      for (const rec of chronoRecords) {
        // Convert score scale to 0.0 - 1.0 bounds
        const normalizedScore = rec.score > 1.0 ? rec.score / 100.0 : rec.score;
        masteryScore = alpha * normalizedScore + (1 - alpha) * masteryScore;
      }

      // Keep masteryScore within 0-1 bounds
      masteryScore = Math.max(0, Math.min(1, masteryScore));

      // Calculate confidence based on attempt sample sizes
      const confidence = Math.min(1.0, chronoRecords.length / 10.0);

      // 4. Update or Upsert UserMastery in PostgreSQL
      const userMastery = await this.prisma.userMastery.upsert({
        where: {
          userId_topicId: {
            userId,
            topicId,
          },
        },
        create: {
          userId,
          topicId,
          masteryScore,
          confidence,
        },
        update: {
          masteryScore,
          confidence,
        },
      });

      // 5. Cache UserMastery in Redis (TTL 5 minutes / 300s)
      const redis = this.redisService.getClient();
      const cacheKey = `user:${userId}:topic:${topicId}:mastery`;
      await redis.set(
        cacheKey,
        JSON.stringify({
          userId,
          topicId,
          masteryScore,
          confidence,
          lastUpdated: userMastery.lastUpdated,
        }),
        "EX",
        300,
      );

      this.logger.log(`Updated UserMastery for ${userId} (topic: ${topicId}) to ${masteryScore.toFixed(3)} (confidence: ${confidence})`);
      return { success: true, userMasteryId: userMastery.id };

    } catch (err: any) {
      this.logger.error(`Mastery calculation task failed: ${err.message}`);
      throw err;
    }
  }
}
