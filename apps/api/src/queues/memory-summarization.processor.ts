import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { MemoryService } from '../modules/memory/memory.service';

export interface MemorySummarizationJobData {
  conversationId: string;
  userId: string;
  tenantId: string;
}

@Processor('memory-summarization')
export class MemorySummarizationProcessor extends WorkerHost {
  private readonly logger = new Logger(MemorySummarizationProcessor.name);

  constructor(private readonly memoryService: MemoryService) {
    super();
  }

  async process(job: Job<MemorySummarizationJobData>): Promise<any> {
    const { conversationId, userId, tenantId } = job.data;
    this.logger.log(`[MemoryQueue] Summarizing conversation=${conversationId}`);

    try {
      await this.memoryService.updateMemory(conversationId, userId, tenantId);
      this.logger.log(`[MemoryQueue] Summary updated for conversation=${conversationId}`);
      return { status: 'completed', conversationId };
    } catch (err: any) {
      this.logger.error(`[MemoryQueue] Summarization failed for conversation=${conversationId}: ${err.message}`);
      throw err;
    }
  }
}

