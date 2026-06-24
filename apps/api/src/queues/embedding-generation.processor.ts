import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EmbeddingJobData {
  chunks: Array<{ id: string; content: string }>;
  documentId: string;
  tenantId: string;
}

@Processor('embedding-generation')
export class EmbeddingGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbeddingGenerationProcessor.name);
  private readonly aiServiceUrl: string;

  constructor(
    private readonly config: ConfigService,
    @InjectQueue('graph-building') private readonly graphQueue: Queue,
  ) {
    super();
    this.aiServiceUrl = this.config.get<string>('NEXT_PUBLIC_AI_SERVICE_URL', 'http://localhost:8000');
  }

  async process(job: Job<EmbeddingJobData>): Promise<any> {
    const { chunks, documentId, tenantId } = job.data;
    this.logger.log(`[EmbeddingQueue] Processing ${chunks.length} chunks for doc=${documentId}`);

    try {
      // Call FastAPI to generate embeddings and upsert into Qdrant
      const response = await fetch(`${this.aiServiceUrl}/ai/embeddings/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chunks, tenantId }),
      });

      if (!response.ok) {
        throw new Error(`FastAPI embedding batch failed: ${response.statusText}`);
      }

      const result = await response.json();
      this.logger.log(`[EmbeddingQueue] Upserted ${result.upserted ?? chunks.length} vectors for doc=${documentId}`);

      // Trigger knowledge graph building as a follow-up job
      await this.graphQueue.add('build-graph', { documentId, chunks, tenantId }, {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
      });

      return { status: 'completed', documentId, vectorsUpserted: result.upserted };
    } catch (err: any) {
      this.logger.error(`[EmbeddingQueue] Failed for doc=${documentId}: ${err.message}`);
      throw err;
    }
  }
}

