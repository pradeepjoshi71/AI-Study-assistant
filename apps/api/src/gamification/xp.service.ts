import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";

import { StreakService } from "./streak.service";
import { LeaderboardService } from "./leaderboard.service";

export const ACTION_XP: Record<string, number> = {
  DOCUMENT_UPLOAD: 50,
  QUIZ_COMPLETION: 100,
  FLASHCARD_REVIEW: 25,
  DAILY_LOGIN: 40,
  SESSION_30MIN: 60,
};

@Injectable()
export class XPService {
  private readonly logger = new Logger(XPService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue("badge-check") private readonly badgeQueue: Queue,
    private readonly streakService: StreakService,
    private readonly leaderboardService: LeaderboardService,
  ) {}

  /**
   * Awards XP to a user's progress log under an active org context (or personal).
   * Ensures idempotency key checks.
   * Recalculates level via level = floor(sqrt(totalXP/100)).
   * Increments weeklyXP and monthlyXP.
   * Dispatches a BullMQ badge-check job.
   */
  async award(
    userId: string,
    orgId: string | null,
    action: string,
    idempotencyKey: string,
  ): Promise<{ success: boolean; xpAwarded: number; newLevel: number }> {
    // 1. Idempotency Check
    const existing = await this.prisma.gamificationIdempotency.findUnique({
      where: { key: idempotencyKey },
    });

    if (existing) {
      this.logger.log(`XP already awarded for idempotencyKey: ${idempotencyKey}`);
      // Retrieve level
      const progress = await this.prisma.userProgress.findUnique({
        where: {
          userId_orgId: { userId, orgId: orgId || "personal" },
        },
      });
      return {
        success: false,
        xpAwarded: 0,
        newLevel: progress?.level || 1,
      };
    }

    const xpToAward = ACTION_XP[action] || 10;
    this.logger.log(
      `Awarding ${xpToAward} XP to user ${userId} for action: ${action} (org: ${orgId})`,
    );

    // 2. Fetch or create UserProgress log
    const progress = await this.prisma.userProgress.upsert({
      where: {
        userId_orgId: { userId, orgId: orgId || "personal" },
      },
      update: {},
      create: {
        userId,
        orgId: orgId || "personal",
        totalXP: 0,
        level: 1,
        weeklyXP: 0,
        monthlyXP: 0,
      },
    });

    const newTotalXP = progress.totalXP + xpToAward;
    // level = floor(sqrt(totalXP/100))
    const calculatedLevel = Math.max(1, Math.floor(Math.sqrt(newTotalXP / 100)));

    // 3. Update UserProgress in a transaction along with Idempotency log
    const updatedProgress = await this.prisma.$transaction(async (tx) => {
      // Create idempotency log
      await tx.gamificationIdempotency.create({
        data: {
          key: idempotencyKey,
          userId,
          orgId: orgId || null,
          action,
          xpAwarded: xpToAward,
        },
      });

      // Update UserProgress statistics
      return tx.userProgress.update({
        where: { id: progress.id },
        data: {
          totalXP: newTotalXP,
          level: calculatedLevel,
          weeklyXP: { increment: xpToAward },
          monthlyXP: { increment: xpToAward },
        },
      });
    });

    // 4. Update Study Streak logs
    try {
      await this.streakService.updateStreak(userId);
    } catch (streakErr: any) {
      this.logger.error(`Failed to update user streak: ${streakErr.message}`);
    }

    // Update Leaderboard logs
    try {
      await this.leaderboardService.recordXp(userId, orgId || "personal", newTotalXP);
    } catch (lErr: any) {
      this.logger.error(`Failed to update user leaderboard: ${lErr.message}`);
    }

    // 5. Dispatch BullMQ badge-check background processing job
    try {
      await this.badgeQueue.add("check-badges", {
        userId,
        orgId: orgId || null,
        action,
        triggerValue: calculatedLevel, // Pass calculated level or triggers
      });
      this.logger.log(`Dispatched badge check job for user: ${userId}`);
    } catch (err: any) {
      this.logger.error(`Failed to dispatch badge-check job: ${err.message}`);
    }

    return {
      success: true,
      xpAwarded: xpToAward,
      newLevel: calculatedLevel,
    };
  }
}
