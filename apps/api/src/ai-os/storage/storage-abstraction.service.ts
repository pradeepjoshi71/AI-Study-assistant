import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { S3Service } from '../../storage/s3.service';
import { RetrievalService } from '../../modules/retrieval/retrieval.service';
import { KnowledgeGraphService } from '../../modules/knowledge-graph/knowledge-graph.service';

@Injectable()
export class StorageAbstractionService {
  private readonly logger = new Logger(StorageAbstractionService.name);
  private readonly aiServiceUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly s3Service: S3Service,
    private readonly retrievalService: RetrievalService,
    private readonly graphService: KnowledgeGraphService,
    private readonly config: ConfigService,
  ) {
    this.aiServiceUrl = this.config.get<string>(
      'NEXT_PUBLIC_AI_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  /**
   * Save context/session memory for an agent in Redis (short-term) and/or Postgres.
   */
  async saveMemory(
    tenantId: string,
    key: string,
    value: any,
    ttlSeconds = 3600,
  ): Promise<void> {
    this.logger.log(`saveMemory called for tenant=${tenantId}, key=${key}`);
    const redisKey = `tenant:${tenantId}:memory:${key}`;
    const client = this.redis.getClient();
    await client.set(redisKey, JSON.stringify(value), 'EX', ttlSeconds);

    // Persist as a historical check point in PostgreSQL (Optional audit/state log)
    try {
      await this.prisma.aiTask.create({
        data: {
          tenantId,
          type: 'MEMORY_SYNC',
          status: 'COMPLETED',
          inputData: { key, action: 'save' },
          outputData: { length: JSON.stringify(value).length },
          costCents: 0,
          latencyMs: 1,
        },
      });
    } catch (e: any) {
      this.logger.warn(`Failed to log memory sync task to database: ${e.message}`);
    }
  }

  /**
   * Get context/session memory for an agent from Redis.
   */
  async getMemory(tenantId: string, key: string): Promise<any | null> {
    const redisKey = `tenant:${tenantId}:memory:${key}`;
    const client = this.redis.getClient();
    const data = await client.get(redisKey);
    if (!data) return null;
    return JSON.parse(data);
  }

  /**
   * Retrieve semantic RAG context from Vector Store (Qdrant).
   * Fully tenant-isolated through QdrantClient filters.
   */
  async getContext(
    tenantId: string,
    query: string,
    documentIds?: string[],
    limit = 5,
  ): Promise<any[]> {
    this.logger.log(`getContext called for tenant=${tenantId}, query="${query}"`);
    return this.retrievalService.retrieve(query, tenantId, documentIds, limit);
  }

  /**
   * Generates embedding and saves point/chunk into Qdrant.
   * Leverages the FastAPI batch processor.
   */
  async storeEmbedding(
    tenantId: string,
    documentId: string,
    chunkId: string,
    text: string,
  ): Promise<void> {
    this.logger.log(
      `storeEmbedding called: tenant=${tenantId}, doc=${documentId}, chunk=${chunkId}`,
    );

    const response = await fetch(`${this.aiServiceUrl}/ai/embeddings/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chunks: [{ id: chunkId, content: text }],
        documentId,
        tenantId,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      this.logger.error(`Embedding storage failed: ${response.status} - ${errText}`);
      throw new Error(`Failed to store vector embedding: ${response.statusText}`);
    }
  }

  /**
   * Retrieve knowledge graph node concepts network for query enrichment.
   */
  async retrieveGraph(tenantId: string, conceptName: string): Promise<any> {
    this.logger.log(`retrieveGraph called for tenant=${tenantId}, concept="${conceptName}"`);
    try {
      return await this.graphService.getConceptNetwork(conceptName, tenantId);
    } catch (err: any) {
      this.logger.warn(`Concept not found or graph fetch failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Upload physical file to S3 document store under tenant key namespace.
   */
  async uploadDocument(
    file: Express.Multer.File,
    tenantId: string,
  ): Promise<{ url: string; key: string }> {
    this.logger.log(`uploadDocument called for tenant=${tenantId}, file=${file.originalname}`);
    return this.s3Service.uploadFile(file, tenantId);
  }
}
