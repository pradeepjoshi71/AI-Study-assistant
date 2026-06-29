import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";
import { PrismaService } from "../prisma/prisma.service";
import { Cron, CronExpression } from "@nestjs/schedule";

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Tracks user XP awards on Leaderboards.
   * Updates redis sorted sets:
   * - leaderboard:{orgId}:weekly
   * - leaderboard:{orgId}:alltime
   */
  async recordXp(userId: string, orgId: string, totalXp: number) {
    const redis = this.redisService.getClient();
    const weeklyKey = `leaderboard:${orgId}:weekly`;
    const alltimeKey = `leaderboard:${orgId}:alltime`;

    try {
      // 1. Update Weekly Leaderboard with total score (or increment, here we store absolute total progress XP)
      await redis.zadd(weeklyKey, totalXp, userId);
      
      // Calculate TTL until Sunday midnight UTC
      const now = new Date();
      const nextSunday = new Date();
      // Set to upcoming Sunday (if today is Sunday, goes to next Sunday)
      const dayOfWeek = now.getUTCDay();
      const daysToSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
      nextSunday.setUTCDate(now.getUTCDate() + daysToSunday);
      nextSunday.setUTCHours(23, 59, 59, 999);
      const ttlSeconds = Math.max(0, Math.floor((nextSunday.getTime() - now.getTime()) / 1000));
      
      await redis.expire(weeklyKey, ttlSeconds);

      // 2. Update All-Time Leaderboard
      await redis.zadd(alltimeKey, totalXp, userId);
      this.logger.log(`Leaderboards updated for user ${userId} in org ${orgId}: XP=${totalXp}`);
    } catch (err: any) {
      this.logger.error(`Failed to update Redis leaderboards: ${err.message}`);
    }
  }

  /**
   * Retrieves top users from a leaderboard sorted set and enriches details from database.
   */
  async getLeaderboard(
    orgId: string,
    period: "weekly" | "alltime",
    userId: string,
    limit = 20,
  ): Promise<{
    leaderboard: Array<{ rank: number; userId: string; name: string; avatar: string | null; score: number }>;
    currentUser: { rank: number | null; score: number | null } | null;
  }> {
    const redis = this.redisService.getClient();
    const key = `leaderboard:${orgId}:${period}`;

    try {
      // 1. ZREVRANGE to get top users with scores
      const rawEntries = await redis.zrevrange(key, 0, limit - 1, "WITHSCORES");
      
      // Parse entries into list of { userId, score }
      const parsedEntries: Array<{ userId: string; score: number }> = [];
      for (let i = 0; i < rawEntries.length; i += 2) {
        parsedEntries.push({
          userId: rawEntries[i],
          score: parseInt(rawEntries[i + 1], 10),
        });
      }

      // 2. Enrich entries with user names and avatar
      const userIds = parsedEntries.map((e) => e.userId);
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, avatar: true },
      });

      const userMap = new Map(users.map((u) => [u.id, u]));

      const leaderboard = parsedEntries.map((entry, idx) => {
        const u = userMap.get(entry.userId);
        return {
          rank: idx + 1,
          userId: entry.userId,
          name: u?.name || "Anonymous Scholar",
          avatar: u?.avatar || null,
          score: entry.score,
        };
      });

      // 3. Find current user's rank (ZREVRANK returns 0-based index)
      const rawRank = await redis.zrevrank(key, userId);
      const rank = rawRank !== null ? rawRank + 1 : null;
      const rawScore = await redis.zscore(key, userId);
      const score = rawScore !== null ? parseInt(rawScore, 10) : null;

      return {
        leaderboard,
        currentUser: { rank, score },
      };
    } catch (err: any) {
      this.logger.error(`Failed to fetch leaderboard: ${err.message}`);
      return { leaderboard: [], currentUser: null };
    }
  }

  /**
   * Cron job running at the end of every month to clean up/reset monthly stats.
   * Note: The weekly sorted sets automatically expire, and all-time is persistent.
   */
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT, {
    timeZone: "UTC",
  })
  async resetMonthlyStatistics() {
    this.logger.log("Cron job trigger: resetting monthly UserProgress stats in database...");
    try {
      await this.prisma.userProgress.updateMany({
        data: {
          monthlyXP: 0,
        },
      });
      this.logger.log("Monthly UserProgress stats cleared successfully.");
    } catch (err: any) {
      this.logger.error(`Failed to reset monthly stats: ${err.message}`);
    }
  }
}
