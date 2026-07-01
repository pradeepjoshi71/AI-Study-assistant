import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ApiKeyService } from '../api-key.service';

/**
 * Handles the async `update-last-used` job dispatched by APIKeyGuard.
 * Runs at concurrency 5 — high throughput, low DB lock contention.
 */
@Processor('api-key-usage', { concurrency: 5 })
export class ApiKeyUsageProcessor extends WorkerHost {
  private readonly logger = new Logger(ApiKeyUsageProcessor.name);

  constructor(private readonly apiKeyService: ApiKeyService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'update-last-used') {
      const { keyId } = job.data as { keyId: string };
      await this.apiKeyService.updateLastUsed(keyId);
    } else if (job.name === 'log-usage') {
      const { keyId, endpoint, method, statusCode, latencyMs, tokensUsed } = job.data as {
        keyId: string;
        endpoint: string;
        method: string;
        statusCode: number;
        latencyMs: number;
        tokensUsed?: number;
      };
      await this.apiKeyService.logUsage({
        keyId,
        endpoint,
        method,
        statusCode,
        latencyMs,
        tokensUsed,
      });
    }
  }
}
