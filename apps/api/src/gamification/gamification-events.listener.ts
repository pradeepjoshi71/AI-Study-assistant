import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { XPService } from "./xp.service";

@Injectable()
export class GamificationEventsListener {
  private readonly logger = new Logger(GamificationEventsListener.name);

  constructor(private readonly xpService: XPService) {}

  @OnEvent("quiz.completed")
  async handleQuizCompleted(payload: { userId: string; orgId: string | null; attemptId: string }) {
    this.logger.log(`Received quiz.completed event for user: ${payload.userId}`);
    await this.xpService.award(
      payload.userId,
      payload.orgId,
      "QUIZ_COMPLETION",
      `xp:quiz_completed:${payload.attemptId}`
    );
  }

  @OnEvent("flashcard.reviewed")
  async handleFlashcardReviewed(payload: { userId: string; orgId: string | null; reviewId: string }) {
    this.logger.log(`Received flashcard.reviewed event for user: ${payload.userId}`);
    await this.xpService.award(
      payload.userId,
      payload.orgId,
      "FLASHCARD_REVIEW",
      `xp:flashcard_reviewed:${payload.reviewId}`
    );
  }

  @OnEvent("session.timer_threshold_reached")
  async handleSessionThreshold(payload: { userId: string; orgId: string | null; sessionId: string }) {
    this.logger.log(`Received session.timer_threshold_reached event for user: ${payload.userId}`);
    await this.xpService.award(
      payload.userId,
      payload.orgId,
      "SESSION_30MIN",
      `xp:session_30min:${payload.sessionId}`
    );
  }
}
