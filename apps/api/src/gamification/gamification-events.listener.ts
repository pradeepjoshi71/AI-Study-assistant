import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { XPService } from "./xp.service";

import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";

@Injectable()
export class GamificationEventsListener {
  private readonly logger = new Logger(GamificationEventsListener.name);

  constructor(
    private readonly xpService: XPService,
    @InjectQueue("push-notifications") private readonly pushQueue: Queue,
  ) {}

  @OnEvent("quiz.completed")
  async handleQuizCompleted(payload: { userId: string; orgId: string | null; attemptId: string }) {
    this.logger.log(`Received quiz.completed event for user: ${payload.userId}`);
    await this.xpService.award(
      payload.userId,
      payload.orgId,
      "QUIZ_COMPLETION",
      `xp:quiz_completed:${payload.attemptId}`
    );

    // Queue push-notification
    await this.pushQueue.add("send-push", {
      userId: payload.userId,
      type: "QUIZ_COMPLETE",
      payload: {
        title: "Quiz Completed! 🎉",
        body: "Check your progress and review the master topics now.",
      },
    }).catch((err) => this.logger.error(`Failed to queue push: ${err.message}`));
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
