import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { Logger } from "@nestjs/common";

@Processor("analytics", { concurrency: 5 })
export class AnalyticsProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalyticsProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    if (job.name === "track-event") {
      const { tenantId, orgId, userId, event, properties, sessionId, createdAt } = job.data;
      try {
        await this.prisma.analyticsEvent.create({
          data: {
            tenantId,
            orgId: orgId || null,
            userId: userId || null,
            event,
            properties: properties || {},
            sessionId: sessionId || null,
            createdAt: createdAt ? new Date(createdAt) : new Date(),
          },
        });
      } catch (err: any) {
        this.logger.error(`Failed to write analytics event "${event}" to partitioned DB: ${err.message}`);
        throw err;
      }
    }
  }
}
