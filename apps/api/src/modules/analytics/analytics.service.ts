import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LogSessionDto, LogQuizAttemptDto, LogFlashcardReviewDto, RecallStatus } from './analytics.types';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly decayRate = 0.05; // 5% decay per day

  constructor(private prisma: PrismaService) {}

  /**
   * Logs a study session duration.
   */
  async logSession(userId: string, tenantId: string, dto: LogSessionDto) {
    const session = await this.prisma.analyticsSession.create({
      data: {
        userId,
        tenantId,
        duration: dto.duration,
      },
    });
    this.logger.log(`Logged study session: ${dto.duration}s for user ${userId}`);
    return session;
  }

  /**
   * Logs a completed quiz attempt and triggers background mastery recalculation.
   */
  async logQuizAttempt(userId: string, tenantId: string, dto: LogQuizAttemptDto) {
    const { quizId, correctAnswers, wrongAnswers } = dto;
    const total = correctAnswers + wrongAnswers;
    const score = total > 0 ? (correctAnswers / total) * 100 : 0;

    const attempt = await this.prisma.quizAttempt.create({
      data: {
        userId,
        tenantId,
        quizId,
        score,
        correctAnswers,
        wrongAnswers,
      },
      include: {
        quiz: true,
      },
    });

    this.logger.log(`Logged quiz attempt for quiz ${quizId}. Score: ${score}%`);

    // Asynchronously update topic mastery based on quiz title/topics
    const topic = attempt.quiz.title.replace('Quiz: ', '').trim();
    this.updateTopicMastery(userId, tenantId, topic).catch((err) => {
      this.logger.error(`Failed to update mastery for topic ${topic}: ${err.message}`);
    });

    return attempt;
  }

  /**
   * Logs a flashcard review and triggers background mastery recalculation.
   */
  async logFlashcardReview(userId: string, tenantId: string, dto: LogFlashcardReviewDto) {
    const { flashcardId, recallStatus } = dto;

    const review = await this.prisma.flashcardReview.create({
      data: {
        userId,
        tenantId,
        flashcardId,
        recallStatus,
      },
      include: {
        flashcard: true,
      },
    });

    this.logger.log(`Logged flashcard review for card ${flashcardId}. Status: ${recallStatus}`);

    // Resolve topic from flashcard tags
    const tags = review.flashcard.tags as string[] || [];
    const topic = tags[0] || 'General';

    this.updateTopicMastery(userId, tenantId, topic).catch((err) => {
      this.logger.error(`Failed to update mastery for topic ${topic}: ${err.message}`);
    });

    return review;
  }

  /**
   * Recalculates and updates the MasteryScore for a specific topic.
   * Utilizes a time-decay weight to discount older quiz attempts and flashcard reviews.
   */
  private async updateTopicMastery(userId: string, tenantId: string, topic: string): Promise<void> {
    this.logger.log(`Recalculating mastery score for topic: "${topic}"...`);

    // 1. Fetch all quiz attempts related to this topic
    const attempts = await this.prisma.quizAttempt.findMany({
      where: {
        userId,
        tenantId,
        quiz: {
          title: { contains: topic },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 2. Fetch all flashcard reviews and filter by topic in-memory (to avoid JSON path typing issues)
    const allReviews = await this.prisma.flashcardReview.findMany({
      where: {
        userId,
        tenantId,
      },
      include: {
        flashcard: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const reviews = allReviews.filter((rev) => {
      const tags = rev.flashcard.tags as string[] || [];
      return tags[0] === topic;
    });

    if (attempts.length === 0 && reviews.length === 0) {
      return;
    }

    const now = Date.now();

    // 3. Compute weighted quiz score with time decay
    let weightedQuizSum = 0;
    let quizWeightSum = 0;

    for (const att of attempts) {
      const daysElapsed = (now - att.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      const weight = Math.exp(-this.decayRate * daysElapsed); // e^(-lambda * t)
      weightedQuizSum += att.score * weight;
      quizWeightSum += weight;
    }

    const quizScore = quizWeightSum > 0 ? weightedQuizSum / quizWeightSum : null;

    // 4. Compute weighted flashcard recall score with time decay
    let weightedRecallSum = 0;
    let flashcardWeightSum = 0;

    for (const rev of reviews) {
      const daysElapsed = (now - rev.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      const weight = Math.exp(-this.decayRate * daysElapsed);
      
      let scoreVal = 0;
      if (rev.recallStatus === RecallStatus.EASY) scoreVal = 100;
      else if (rev.recallStatus === RecallStatus.HARD) scoreVal = 50;
      else scoreVal = 0; // FAIL

      weightedRecallSum += scoreVal * weight;
      flashcardWeightSum += weight;
    }

    const flashcardScore = flashcardWeightSum > 0 ? weightedRecallSum / flashcardWeightSum : null;

    // 5. Combine scores (60% quiz weight, 40% flashcard weight)
    let finalScore = 0;
    if (quizScore !== null && flashcardScore !== null) {
      finalScore = 0.6 * quizScore + 0.4 * flashcardScore;
    } else if (quizScore !== null) {
      finalScore = quizScore;
    } else if (flashcardScore !== null) {
      finalScore = flashcardScore;
    }

    // 6. Save or update MasteryScore
    const existing = await this.prisma.masteryScore.findFirst({
      where: {
        userId,
        tenantId,
        topic,
      },
    });

    if (existing) {
      await this.prisma.masteryScore.update({
        where: { id: existing.id },
        data: { score: finalScore },
      });
    } else {
      await this.prisma.masteryScore.create({
        data: {
          userId,
          tenantId,
          topic,
          score: finalScore,
        },
      });
    }

    this.logger.log(`Updated topic "${topic}" mastery score: ${finalScore.toFixed(2)}%`);
  }

  /**
   * Generates aggregated learning stats for the dashboard.
   */
  async getDashboardSummary(userId: string, tenantId: string) {
    // 1. Core aggregates
    const sessionSum = await this.prisma.analyticsSession.aggregate({
      where: { userId, tenantId },
      _sum: { duration: true },
    });

    const quizCount = await this.prisma.quizAttempt.count({
      where: { userId, tenantId },
    });

    const quizAvg = await this.prisma.quizAttempt.aggregate({
      where: { userId, tenantId },
      _avg: { score: true },
    });

    const flashcardCount = await this.prisma.flashcardReview.count({
      where: { userId, tenantId },
    });

    // 2. Streaks calculation
    const streak = await this.calculateStreak(userId, tenantId);

    // 3. Topic masteries
    const masteries = await this.prisma.masteryScore.findMany({
      where: { userId, tenantId },
      orderBy: { score: 'asc' }, // show weaker areas first
    });

    return {
      totalStudyTimeMinutes: Math.round((sessionSum._sum.duration || 0) / 60),
      totalQuizzesTaken: quizCount,
      averageQuizScore: Math.round(quizAvg._avg.score || 0),
      totalFlashcardsReviewed: flashcardCount,
      streakDays: streak,
      topicMastery: masteries.map((m) => ({
        topic: m.topic,
        score: Math.round(m.score),
        status: m.score >= 80 ? 'strong' : m.score >= 50 ? 'medium' : 'weak',
      })),
    };
  }

  /**
   * Calculates the consecutive daily study streak.
   */
  private async calculateStreak(userId: string, tenantId: string): Promise<number> {
    const sessions = await this.prisma.analyticsSession.findMany({
      where: { userId, tenantId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    if (sessions.length === 0) return 0;

    const uniqueDates = Array.from(
      new Set(sessions.map((s) => s.createdAt.toDateString())),
    ).map((d) => new Date(d));

    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // If the latest session was not today or yesterday, streak is broken/0
    const latestDate = uniqueDates[0];
    latestDate.setHours(0, 0, 0, 0);

    if (latestDate.getTime() !== today.getTime() && latestDate.getTime() !== yesterday.getTime()) {
      return 0;
    }

    const checkDate = latestDate;
    for (let i = 0; i < uniqueDates.length; i++) {
      const d = uniqueDates[i];
      d.setHours(0, 0, 0, 0);

      if (d.getTime() === checkDate.getTime()) {
        streak++;
        // Check previous day
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    return streak;
  }

  /**
   * Compiles activity logs over the last 14 days.
   */
  async getProgressTimeline(userId: string, tenantId: string) {
    const timeline = [];
    const now = new Date();

    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const nextDay = new Date(d);
      nextDay.setDate(nextDay.getDate() + 1);

      // Quiz taken count
      const quizzes = await this.prisma.quizAttempt.count({
        where: {
          userId,
          tenantId,
          createdAt: { gte: d, lt: nextDay },
        },
      });

      // Flashcards reviewed count
      const flashcards = await this.prisma.flashcardReview.count({
        where: {
          userId,
          tenantId,
          createdAt: { gte: d, lt: nextDay },
        },
      });

      // Study duration
      const sessionSum = await this.prisma.analyticsSession.aggregate({
        where: {
          userId,
          tenantId,
          createdAt: { gte: d, lt: nextDay },
        },
        _sum: { duration: true },
      });

      timeline.push({
        date: d.toISOString().split('T')[0],
        studyTimeMinutes: Math.round((sessionSum._sum.duration || 0) / 60),
        quizzesTaken: quizzes,
        flashcardsReviewed: flashcards,
      });
    }

    return timeline;
  }

  /**
   * Fetches full topic mastery detail list.
   */
  async getTopicMastery(userId: string, tenantId: string) {
    return this.prisma.masteryScore.findMany({
      where: { userId, tenantId },
      orderBy: { score: 'desc' },
    });
  }
}
