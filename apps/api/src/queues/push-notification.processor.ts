import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PushService } from "../platform/push.service";

@Processor("push-notifications")
export class PushNotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(PushNotificationProcessor.name);

  constructor(private readonly pushService: PushService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { userId, type, payload } = job.data;
    if (!userId || !type || !payload) {
      this.logger.error(`Job ${job.id} missing notification parameters.`);
      return { success: false, error: "Missing parameters" };
    }

    this.logger.log(`Processing push notification job ${job.id} for user ${userId} (type: ${type})`);

    try {
      await this.pushService.sendPushNotification(userId, type, payload);
      return { success: true };
    } catch (err: any) {
      this.logger.error(`Failed to execute push notification job: ${err.message}`);
      throw err;
    }
  }
}
