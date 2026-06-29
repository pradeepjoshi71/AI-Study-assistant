import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import { DocumentStatus } from "@prisma/client";

import { RedisService } from "../redis/redis.service";
import { XPService } from "../gamification/xp.service";

@Processor("document-processing")
export class DocumentProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentProcessingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly xpService: XPService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { documentId } = job.data;
    if (!documentId) {
      this.logger.error(`Job ${job.id} missing documentId`);
      return { success: false, error: "Missing documentId" };
    }

    this.logger.log(`Processing document job ${job.id} for documentId ${documentId}`);

    // Update status to PROCESSING
    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.PROCESSING,
        processingStartedAt: new Date(),
      },
    });
    this._publishStatus(documentId, "PROCESSING");

    try {
      const doc = await this.prisma.document.findUnique({
        where: { id: documentId },
      });

      if (!doc) {
        throw new Error(`Document ${documentId} not found in database`);
      }

      // Determine FastAPI endpoint url
      const aiServiceUrl =
        this.configService.get<string>("NEXT_PUBLIC_AI_SERVICE_URL") ||
        "http://localhost:8000";

      // 1. Call FastAPI parse endpoint to extract raw segments
      this.logger.log(`Invoking FastAPI parse pipeline for ${documentId}`);
      
      const parseResponse = await fetch(`${aiServiceUrl}/ai/pipeline/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          storageKey: doc.storageKey,
          mimeType: doc.mimeType,
        }),
      });

      if (!parseResponse.ok) {
        const errText = await parseResponse.text();
        throw new Error(`FastAPI parse pipeline failed: ${parseResponse.statusText} - ${errText}`);
      }

      const parseResult = await parseResponse.json();
      const segments = parseResult.segments || [];

      // 2. Call FastAPI chunk-embed endpoint to chunk and embed segments
      this.logger.log(`Invoking FastAPI chunk-embed pipeline for ${documentId}`);
      const chunkEmbedResponse = await fetch(`${aiServiceUrl}/ai/pipeline/chunk-embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          segments,
        }),
      });

      if (!chunkEmbedResponse.ok) {
        const errText = await chunkEmbedResponse.text();
        throw new Error(`FastAPI chunk-embed pipeline failed: ${chunkEmbedResponse.statusText} - ${errText}`);
      }

      const chunkEmbedResult = await chunkEmbedResponse.json();
      const chunks = chunkEmbedResult.chunks || [];

      // 3. Upsert to Qdrant collection study_chunks via FastAPI upsert endpoint
      this.logger.log(`Invoking FastAPI Qdrant upsert pipeline for ${documentId}`);
      const upsertResponse = await fetch(`${aiServiceUrl}/ai/pipeline/upsert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          orgId: doc.orgId || "personal",
          chunks,
        }),
      });

      if (!upsertResponse.ok) {
        const errText = await upsertResponse.text();
        throw new Error(`FastAPI Qdrant upsert failed: ${upsertResponse.statusText} - ${errText}`);
      }

      const upsertResult = await upsertResponse.json();

      // Calculate total text length
      const fullText = segments.map((s: any) => s.text).join(" ");

      // 4. Update Document status=READY, pageCount, and chunkCount
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: DocumentStatus.READY,
          chunkCount: chunks.length,
          pageCount: chunks.length > 0 ? Math.max(...chunks.map((c: any) => c.pageRef)) : 0,
          extractedTextLength: fullText.length,
          processingCompletedAt: new Date(),
          errorMessage: null,
        },
      });
      this._publishStatus(documentId, "READY", chunks.length);

      // Award XP for successful document ingestion
      try {
        await this.xpService.award(
          doc.userId,
          doc.orgId,
          "DOCUMENT_UPLOAD",
          `xp:doc_upload:${documentId}`
        );
      } catch (xpErr: any) {
        this.logger.error(`Failed to award upload XP: ${xpErr.message}`);
      }

      this.logger.log(`Document ${documentId} processed successfully. Chunks: ${chunks.length}`);
      return { success: true, chunkCount: chunks.length };

    } catch (err: any) {
      this.logger.error(`Error processing job ${job.id} for document ${documentId}: ${err.message}`);

      // On failure update Document status=FAILED and errorMessage
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: DocumentStatus.FAILED,
          errorMessage: err.message,
          processingCompletedAt: new Date(),
        },
      });
      this._publishStatus(documentId, "FAILED", 0, err.message);

      throw err; // throw so BullMQ handles retry
    }
  }

  private _publishStatus(documentId: string, status: string, chunkCount = 0, errorMessage?: string) {
    try {
      const redis = this.redisService.getClient();
      redis.publish(
        "document:status_changed",
        JSON.stringify({ documentId, status, chunkCount, errorMessage })
      );
    } catch (pubErr: any) {
      this.logger.warn(`Failed to publish status change to Redis: ${pubErr.message}`);
    }
  }
}
