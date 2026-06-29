import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { userContextStorage } from "../common/context/user-context";

@UseGuards(JwtAuthGuard)
@Controller("progress")
export class ProgressController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("me")
  async getMyProgress(@CurrentUser("id") userId: string) {
    const orgId = userContextStorage.getStore()?.orgId || "personal";

    // 1. Fetch UserProgress
    const progress = await this.prisma.userProgress.findUnique({
      where: {
        userId_orgId: { userId, orgId },
      },
    }) || {
      totalXP: 0,
      level: 1,
      weeklyXP: 0,
      monthlyXP: 0,
    };

    // 2. Fetch Streak
    const streak = await this.prisma.streak.findUnique({
      where: { userId },
    }) || {
      currentStreak: 0,
      longestStreak: 0,
    };

    // 3. Fetch Badges (joined with UserBadge)
    const earnedBadges = await this.prisma.userBadge.findMany({
      where: { userId },
      include: { badge: true },
    });

    const allBadges = await this.prisma.badge.findMany();

    const earnedBadgeIds = new Set(earnedBadges.map((ub) => ub.badgeId));
    const badgesPayload = allBadges.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      icon: b.icon,
      triggerType: b.triggerType,
      triggerValue: b.triggerValue,
      earned: earnedBadgeIds.has(b.id),
      earnedAt: earnedBadges.find((ub) => ub.badgeId === b.id)?.earnedAt || null,
    }));

    // 4. Weekly Activity (last 7 days XP per day from gamification_idempotency_log)
    const last7Days: Array<{ date: string; xp: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      last7Days.push({ date: dateStr, xp: 0 });
    }

    const startOfWeeklyPeriod = new Date();
    startOfWeeklyPeriod.setUTCDate(startOfWeeklyPeriod.getUTCDate() - 6);
    startOfWeeklyPeriod.setUTCHours(0, 0, 0, 0);

    const weeklyLogs = await this.prisma.gamificationIdempotency.findMany({
      where: {
        userId,
        createdAt: {
          gte: startOfWeeklyPeriod,
        },
      },
      select: {
        xpAwarded: true,
        createdAt: true,
      },
    });

    weeklyLogs.forEach((log) => {
      const logDate = new Date(log.createdAt).toISOString().split("T")[0];
      const match = last7Days.find((day) => day.date === logDate);
      if (match) {
        match.xp += log.xpAwarded;
      }
    });

    // 5. Heatmap Activity (last 90 days XP logs grouped by day)
    const heatmapDays: Record<string, number> = {};
    const startOfHeatmapPeriod = new Date();
    startOfHeatmapPeriod.setUTCDate(startOfHeatmapPeriod.getUTCDate() - 89);
    startOfHeatmapPeriod.setUTCHours(0, 0, 0, 0);

    const heatmapLogs = await this.prisma.gamificationIdempotency.findMany({
      where: {
        userId,
        createdAt: {
          gte: startOfHeatmapPeriod,
        },
      },
      select: {
        xpAwarded: true,
        createdAt: true,
      },
    });

    heatmapLogs.forEach((log) => {
      const logDate = new Date(log.createdAt).toISOString().split("T")[0];
      heatmapDays[logDate] = (heatmapDays[logDate] || 0) + log.xpAwarded;
    });

    const heatmapArray = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      heatmapArray.push({
        date: dateStr,
        count: heatmapDays[dateStr] || 0,
      });
    }

    return {
      progress: {
        totalXP: progress.totalXP,
        level: progress.level,
        weeklyXP: progress.weeklyXP,
        monthlyXP: progress.monthlyXP,
      },
      streak: {
        currentStreak: streak.currentStreak,
        longestStreak: streak.longestStreak,
      },
      badges: badgesPayload,
      weeklyActivity: last7Days,
      heatmap: heatmapArray,
    };
  }
}
