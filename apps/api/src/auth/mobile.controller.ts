import { Controller, Get, Query, Param, Put, Body, UseGuards } from "@nestjs/common";
import { MobileJwtAuthGuard } from "../auth/guards/mobile-jwt.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { LeaderboardService } from "../gamification/leaderboard.service";
import { encodeCursor, decodeCursor } from "../common/utils/cursor-pagination";
import { userContextStorage } from "../common/context/user-context";

@UseGuards(MobileJwtAuthGuard)
@Controller("mobile")
export class MobileController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboardService: LeaderboardService,
  ) {}

  /**
   * 1. GET /mobile/docs - List user's documents (id, title, status, chunkCount)
   * Cursor-paginated (using base64 of id + createdAt).
   */
  @Get("docs")
  async getDocs(
    @CurrentUser("id") userId: string,
    @Query("limit") limit = "10",
    @Query("cursor") cursor?: string,
  ) {
    const parsedLimit = Math.min(50, parseInt(limit, 10) || 10);
    const decoded = cursor ? decodeCursor(cursor) : null;

    const orgId = userContextStorage.getStore()?.orgId || undefined;

    const docs = await this.prisma.document.findMany({
      where: {
        userId,
        orgId,
        ...(decoded
          ? {
              createdAt: { lt: decoded.createdAt },
            }
          : {}),
      },
      select: {
        id: true,
        title: true,
        status: true,
        chunkCount: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: parsedLimit + 1, // Take 1 extra to determine next cursor
    });

    const hasMore = docs.length > parsedLimit;
    const records = hasMore ? docs.slice(0, parsedLimit) : docs;
    const lastRecord = records[records.length - 1];
    const nextCursor = lastRecord ? encodeCursor(lastRecord.id, lastRecord.createdAt) : null;

    return {
      data: records,
      cursor: hasMore ? nextCursor : null,
    };
  }

  /**
   * 2. GET /mobile/chat/:conversationId/messages - Retrieve last 20 messages with cursor
   */
  @Get("chat/:conversationId/messages")
  async getMessages(
    @Param("conversationId") conversationId: string,
    @Query("limit") limit = "20",
    @Query("cursor") cursor?: string,
  ) {
    const parsedLimit = Math.min(50, parseInt(limit, 10) || 20);
    const decoded = cursor ? decodeCursor(cursor) : null;

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(decoded
          ? {
              createdAt: { lt: decoded.createdAt },
            }
          : {}),
      },
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: parsedLimit + 1,
    });

    const hasMore = messages.length > parsedLimit;
    const records = hasMore ? messages.slice(0, parsedLimit) : messages;
    const lastRecord = records[records.length - 1];
    const nextCursor = lastRecord ? encodeCursor(lastRecord.id, lastRecord.createdAt) : null;

    return {
      data: records,
      cursor: hasMore ? nextCursor : null,
    };
  }

  /**
   * 3. PUT /mobile/quiz/:questionId/answer - Answer single quiz question
   */
  @Put("quiz/:questionId/answer")
  async answerQuizQuestion(
    @Param("questionId") questionId: string,
    @Body("selectedOption") selectedOption: string,
    @CurrentUser("id") userId: string,
  ) {
    const question = await this.prisma.quizQuestion.findUnique({
      where: { id: questionId },
    });

    if (!question) {
      return { error: "Question not found" };
    }

    const isCorrect = question.answer.trim().toLowerCase() === selectedOption.trim().toLowerCase();

    return {
      questionId,
      selectedOption,
      isCorrect,
      correctAnswer: question.answer,
      explanation: question.explanation,
    };
  }

  /**
   * 4. GET /mobile/progress - Retrieve user's level, streaks, and top 3 badges
   */
  @Get("progress")
  async getProgress(@CurrentUser("id") userId: string) {
    const orgId = userContextStorage.getStore()?.orgId || "personal";

    // Select specific properties to optimize db retrieval
    const progress = await this.prisma.userProgress.findUnique({
      where: { userId_orgId: { userId, orgId } },
      select: { totalXP: true, level: true, weeklyXP: true },
    }) || { totalXP: 0, level: 1, weeklyXP: 0 };

    const streak = await this.prisma.streak.findUnique({
      where: { userId },
      select: { currentStreak: true, longestStreak: true },
    }) || { currentStreak: 0, longestStreak: 0 };

    // Fetch top 3 badges (first 3 earned)
    const userBadges = await this.prisma.userBadge.findMany({
      where: { userId },
      take: 3,
      orderBy: { earnedAt: "asc" },
      select: {
        badge: {
          select: {
            id: true,
            name: true,
            icon: true,
            description: true,
          },
        },
      },
    });

    const topBadges = userBadges.map((ub) => ub.badge);

    return {
      level: progress.level,
      totalXP: progress.totalXP,
      weeklyXP: progress.weeklyXP,
      streak: {
        current: streak.currentStreak,
        max: streak.longestStreak,
      },
      topBadges,
    };
  }

  /**
   * 5. GET /mobile/leaderboard - Fetch top 10 users + user's own ranking
   */
  @Get("leaderboard")
  async getLeaderboard(
    @CurrentUser("id") userId: string,
    @Query("period") period: "weekly" | "alltime" = "weekly",
  ) {
    const orgId = userContextStorage.getStore()?.orgId || "personal";

    // Retrieve leaderboard with limit = 10
    const board = await this.leaderboardService.getLeaderboard(orgId, period, userId, 10);
    return board;
  }
}
