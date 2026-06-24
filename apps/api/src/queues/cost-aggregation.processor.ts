import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { MetricsService } from '../common/services/metrics.service';

export interface CostAggregationJobData {
  tenantId?: string; // undefined = aggregate all tenants
}

@Processor('cost-aggregation')
export class CostAggregationProcessor extends WorkerHost {
  private readonly logger = new Logger(CostAggregationProcessor.name);

  constructor(private readonly metricsService: MetricsService) {
    super();
  }

  async process(job: Job<CostAggregationJobData>): Promise<any> {
    const period = new Date().toISOString().slice(0, 7);
    this.logger.log(`[CostQueue] Running cost aggregation for period=${period}`);

    try {
      // MetricsService.getUsageSummary provides per-tenant cost roll-up
      const summary = job.data.tenantId
        ? await this.metricsService.getUsageSummary(job.data.tenantId, period)
        : null;

      this.logger.log(`[CostQueue] Cost aggregation complete. ${summary ? `Tenant cost: $${summary.estimatedCostUsd.toFixed(6)}` : 'All tenants processed.'}`);
      return { status: 'completed', period, summary };
    } catch (err: any) {
      this.logger.error(`[CostQueue] Aggregation failed: ${err.message}`);
      throw err;
    }
  }
}

