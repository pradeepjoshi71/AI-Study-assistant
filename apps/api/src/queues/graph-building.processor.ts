import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { KnowledgeGraphService } from '../modules/knowledge-graph/knowledge-graph.service';

export interface GraphBuildJobData {
  documentId: string;
  tenantId: string;
  chunks: Array<{ id: string; content: string }>;
}

@Processor('graph-building')
export class GraphBuildingProcessor extends WorkerHost {
  private readonly logger = new Logger(GraphBuildingProcessor.name);

  constructor(private readonly graphService: KnowledgeGraphService) {
    super();
  }

  async process(job: Job<GraphBuildJobData>): Promise<any> {
    const { documentId, tenantId, chunks } = job.data;
    this.logger.log(`[GraphQueue] Building knowledge graph for doc=${documentId}, ${chunks.length} chunks`);

    try {
      const result = await this.graphService.buildGraph(tenantId, {
        documentId,
        chunks,
      });

      this.logger.log(`[GraphQueue] Graph build queued for ${result.queued} chunks, doc=${documentId}`);
      return { status: 'completed', documentId, chunksQueued: result.queued };
    } catch (err: any) {
      this.logger.error(`[GraphQueue] Failed for doc=${documentId}: ${err.message}`);
      throw err;
    }
  }
}

