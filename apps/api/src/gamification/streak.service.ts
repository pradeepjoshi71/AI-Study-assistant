import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { Cron, CronExpression } from "@nestjs/schedule";

@Injectable()
export class StreakService {
  private readonly logger = new Logger(StreakService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue("badge-check") private readonly badgeQueue: Queue,
    @InjectQueue("push-notifications") private readonly pushQueue: Queue,
  ) {}

  /**
   * Evaluates and updates study streaks for a user on every XP award action.
   * Compares lastActivityDate to today (UTC).
   * - If yesterday: increment currentStreak, update longestStreak if exceeded.
   * - If today: no change.
   * - If gap > 1: reset to 1.
   * - Update lastActivityDate.
   * Dispatches a BullMQ badge-check job for streak milestones.
   */
  async updateStreak(userId: string): Promise<number> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const streak = await this.prisma.streak.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        currentStreak: 0,
        longestStreak: 0,
        lastActivityDate: null,
      },
    });

    let current = streak.currentStreak;
    let longest = streak.longestStreak;

    if (!streak.lastActivityDate) {
      // First activity
      current = 1;
      longest = Math.max(longest, 1);
    } else {
      const lastAct = new Date(streak.lastActivityDate);
      lastAct.setUTCHours(0, 0, 0, 0);

      const diffTime = today.getTime() - lastAct.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        // Yesterday: increment streak
        current += 1;
        longest = Math.max(longest, current);
      } else if (diffDays > 1) {
        // Gap > 1 day: reset streak to 1
        current = 1;
      }
      // If diffDays === 0 (today): no change to streak length
    }

    // Update streak record
    const updatedStreak = await this.prisma.streak.update({
      where: { userId },
      data: {
        currentStreak: current,
        longestStreak: longest,
        lastActivityDate: new Date(),
      },
    });

    this.logger.log(
      `Streak updated for user ${userId}: current=${current}, longest=${longest}`,
    );

    // Dispatch badge check for streak milestones (7, 30, 100 days)
    if ([7, 30, 100].includes(current)) {
      try {
        await this.badgeQueue.add("check-badges", {
          userId,
          action: "STREAK_MILESTONE",
          triggerValue: current,
        });
        this.logger.log(
          `Dispatched streak badge check job for user: ${userId} (Streak: ${current})`,
        );
      } catch (err: any) {
        this.logger.error(`Failed to dispatch streak badge job: ${err.message}`);
      }
    }

    return current;
  }

  /**
   * Cron job running at midnight UTC every day.
   * Finds all streak records where lastActivityDate is older than yesterday, and resets currentStreak = 0.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    timeZone: "UTC",
  })
  async resetExpiredStreaks() {
    this.logger.log("Cron job trigger: checking for expired streaks...");

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);

    try {
      // Find all streak records where lastActivityDate < yesterday
      const expired = await this.prisma.streak.updateMany({
        where: {
          lastActivityDate: {
            lt: yesterday,
          },
          currentStreak: {
            gt: 0,
          },
        },
        data: {
          currentStreak: 0,
        },
      });

      this.logger.log(`Streak reset job complete. Reset ${expired.count} streaks to 0.`);
    } catch (err: any) {
      this.logger.error(`Failed to execute streak reset cron: ${err.message}`);
    }
  }

  /**
   * Cron job running hourly to check and dispatch streak reminders at 8 PM (20:00) 
   * in each user's local timezone (approximated here by checking UTC offsets or system time).
   * Since this is a lightweight backend, we run every hour to check user timezone offsets,
   * or target users whose current local hour is 20 (8pm).
   */
  @Cron(CronExpression.EVERY_HOUR)
  async sendStreakReminders() {
    this.logger.log("Hourly Cron: checking for streak reminders at 8pm local time...");

    try {
      const today = new Date();
      const currentUtcHour = today.getUTCHours();

      // Find all users who haven't completed activity today
      const activeStreaks = await this.prisma.streak.findMany({
        where: {
          currentStreak: { gt: 0 },
        },
        include: {
          user: {
            select: {
              id: true,
              timezone: true, // User timezone (defaulting to e.g. "UTC" or offset hours)
            },
          },
        },
      });

      for (const streak of activeStreaks) {
        // Resolve timezone offset. If user.timezone is not defined, default to UTC.
        // We'll target users whose local hour matches 20:00 (8pm).
        const timezone = streak.user.timezone || "UTC";
        
        let localHour = currentUtcHour;
        try {
          const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            hour: "numeric",
            hour12: false,
          });
          localHour = parseInt(formatter.format(today), 10);
        } catch {
          // fallback to UTC
        }

        if (localHour === 20) {
          // If already studied today, skip
          if (streak.lastActivityDate) {
            const lastAct = new Date(streak.lastActivityDate);
            lastAct.setUTCHours(0, 0, 0, 0);
            const todayUtc = new Date();
            todayUtc.setUTCHours(0, 0, 0, 0);
            if (lastAct.getTime() === todayUtc.getTime()) {
              continue;
            }
          }

          // Queue push reminder
          await this.pushQueue.add("send-push", {
            userId: streak.userId,
            type: "STREAK_REMINDER",
            payload: {
              title: "Keep your streak alive! 🔥",
              body: `You are on a ${streak.currentStreak} day study streak. Keep it up today!`,
            },
          }).catch((err) => this.logger.error(`Failed to queue streak push: ${err.message}`));
        }
      }
    } catch (err: any) {
      this.logger.error(`Failed to execute streak reminder job: ${err.message}`);
    }
  }
}
