import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";

export interface AnalyticsEventDto {
  tenantId: string;
  orgId?: string | null;
  userId?: string | null;
  event: string;
  properties: Record<string, any>;
  sessionId?: string | null;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectQueue("analytics") private readonly analyticsQueue: Queue,
  ) {}

  /**
   * Tracks an event by enqueuing a BullMQ job in a fire-and-forget manner.
   */
  track(dto: AnalyticsEventDto) {
    this.analyticsQueue
      .add("track-event", {
        ...dto,
        createdAt: new Date(),
      })
      .catch((err) => {
        this.logger.error(`Failed to dispatch analytics event job: ${err.message}`);
      });
  }
}
