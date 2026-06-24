import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AnalyticsAggregationJobData {
  tenantId?: string; // undefined = process all tenants
  period?: string;   // "YYYY-MM", default = current month
}

@Processor('analytics-aggregation')
export class AnalyticsAggregationProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalyticsAggregationProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<AnalyticsAggregationJobData>): Promise<any> {
    const period = job.data.period ?? new Date().toISOString().slice(0, 7);
    this.logger.log(`[AnalyticsQueue] Running aggregation for period=${period}`);

    try {
      // Count quiz attempts in the period
      const [year, month] = period.split('-').map(Number);
      const from = new Date(year, month - 1, 1);
      const to = new Date(year, month, 1);

      const attemptCount = await this.prisma.quizAttempt.count({
        where: { createdAt: { gte: from, lt: to } },
      });

      this.logger.log(`[AnalyticsQueue] Aggregated ${attemptCount} quiz attempts for period=${period}`);
      return { status: 'completed', period, attemptCount };
    } catch (err: any) {
      this.logger.error(`[AnalyticsQueue] Aggregation failed: ${err.message}`);
      throw err;
    }
  }
}

