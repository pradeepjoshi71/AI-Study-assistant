import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { Document, DocumentStatus } from "@prisma/client";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { userContextStorage } from "../common/context/user-context";
import { createId } from "@paralleldrive/cuid2";

import { ConfigService } from "@nestjs/config";

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    @InjectQueue("document-processing") private documentQueue: Queue,
    private eventEmitter: EventEmitter2,
    private configService: ConfigService,
  ) {}

  async upload(
    file: Express.Multer.File,
    userId: string,
    customTitle?: string,
  ): Promise<Document> {
    if (!file) throw new BadRequestException("No file provided");

    const orgId = userContextStorage.getStore()?.orgId ?? "personal";
    const docId = createId(); // pre-generate so we can use it in the storage key
    const title = customTitle || file.originalname;
    const fileExtension = file.originalname.split(".").pop() || "";

    this.logger.log(
      `Uploading: user=${userId} org=${orgId} doc=${docId} file=${file.originalname}`,
    );

    // ── 1. Upload to Minio → orgs/{orgId}/docs/{docId}/{filename} ──────────
    let storageResult: Awaited<ReturnType<StorageService["upload"]>>;
    try {
      storageResult = await this.storage.upload(file, orgId, docId);
    } catch (err: any) {
      this.logger.error(`Storage upload error: ${err.message}`);
      throw new BadRequestException("Failed to upload file to storage");
    }

    // ── 2. Persist Document metadata (PENDING until worker finishes) ────────
    const document = await this.prisma.document.create({
      data: {
        id: docId,
        userId,
        orgId: orgId === "personal" ? null : orgId,
        title,
        originalName: file.originalname,
        fileType: fileExtension.toUpperCase(),
        mimeType: file.mimetype,
        sizeBytes: file.size,
        fileUrl: storageResult.url,
        storageKey: storageResult.key,
        status: DocumentStatus.PENDING,
      },
    });

    // ── 3. Dispatch BullMQ processing job ───────────────────────────────────
    try {
      await this.documentQueue.add("process-document", {
        documentId: document.id,
      });
      this.logger.log(`Dispatched processing job for document: ${document.id}`);
    } catch (err: any) {
      this.logger.error(
        `Failed to dispatch BullMQ job for document ${document.id}: ${err.message}`,
      );
      // Don't fail the upload — worker can be re-triggered manually
    }

    // ── 4. Emit for cache invalidation ──────────────────────────────────────
    this.eventEmitter.emit("document.uploaded", { userId, documentId: document.id });

    return document;
  }

  async findAll(userId: string): Promise<Document[]> {
    const orgId = userContextStorage.getStore()?.orgId;
    return this.prisma.document.findMany({
      where: orgId ? { orgId } : { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: string, userId: string): Promise<Document> {
    const document = await this.prisma.document.findUnique({ where: { id } });
    if (!document) throw new NotFoundException("Document not found");

    const orgId = userContextStorage.getStore()?.orgId;
    if (orgId) {
      if (document.orgId !== orgId)
        throw new ForbiddenException("You do not have access to this document");
    } else if (document.userId !== userId) {
      throw new ForbiddenException("You do not have access to this document");
    }

    return document;
  }

  async delete(id: string, userId: string): Promise<{ success: boolean; message: string }> {
    const document = await this.findOne(id, userId);

    // 1. Delete Qdrant vectors
    this.logger.log(`Deleting Qdrant vectors for docId=${id}`);
    try {
      const aiServiceUrl =
        this.configService.get<string>("NEXT_PUBLIC_AI_SERVICE_URL") ||
        "http://localhost:8000";

      const res = await fetch(`${aiServiceUrl}/ai/pipeline/upsert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: id,
          orgId: document.orgId || "personal",
          chunks: [],
        }),
      });
      if (!res.ok) {
        this.logger.warn(`FastAPI delete call failed: ${res.statusText}`);
      }
    } catch (err: any) {
      this.logger.error(`FastAPI delete error: ${err.message}`);
    }

    // 2. Delete MinIO file
    this.logger.log(`Deleting from storage: key=${document.storageKey}`);
    try {
      await this.storage.delete(document.storageKey);
    } catch (err: any) {
      this.logger.error(`Storage delete error: ${err.message}`);
    }

    // 3. Delete database record
    await this.prisma.document.delete({ where: { id } });
    return { success: true, message: "Document deleted successfully" };
  }

  /** Returns a 1-hour presigned GET URL for the document's storage key. */
  async getSignedUrl(id: string, userId: string, expiresIn = 3600): Promise<string> {
    const document = await this.findOne(id, userId);
    return this.storage.getSignedUrl(document.storageKey, expiresIn);
  }

  async findChunks(id: string, userId: string) {
    await this.findOne(id, userId);
    return this.prisma.documentChunk.findMany({
      where: { documentId: id },
      orderBy: { chunkIndex: "asc" },
    });
  }

  async findStatus(id: string, userId: string) {
    const doc = await this.findOne(id, userId);
    return {
      status: doc.status,
      errorMessage: doc.errorMessage,
      chunkCount: doc.chunkCount,
      startedAt: doc.processingStartedAt,
      completedAt: doc.processingCompletedAt,
    };
  }

  async findMetadata(id: string, userId: string) {
    const doc = await this.findOne(id, userId);
    return {
      originalName: doc.originalName,
      sizeBytes: doc.sizeBytes,
      mimeType: doc.mimeType,
      fileUrl: doc.fileUrl,
      storageKey: doc.storageKey,
      pageCount: doc.pageCount,
      chunkCount: doc.chunkCount,
      extractedTextLength: doc.extractedTextLength,
    };
  }

  async findAssets(id: string, userId: string) {
    await this.findOne(id, userId);
    
    // Find all chunks belonging to this document
    const chunks = await this.prisma.documentChunk.findMany({
      where: { documentId: id },
      include: {
        images: true,
      },
    });

    // Extract all image/table modal assets mapped in database chunks
    const assets = [];
    for (const chunk of chunks) {
      for (const img of chunk.images) {
        let signedUrl = "";
        try {
          signedUrl = await this.storage.getSignedUrl(img.storageKey, 3600);
        } catch {}
        
        assets.push({
          id: img.id,
          chunkId: img.chunkId,
          modality: chunk.modality,
          storageKey: img.storageKey,
          url: signedUrl,
          width: img.width,
          height: img.height,
          pageRef: img.pageRef,
          caption: img.caption,
          imageHash: img.imageHash,
        });
      }
    }
    return assets;
  }

  async uploadInlineImage(file: Express.Multer.File, userId: string) {
    const orgId = userContextStorage.getStore()?.orgId ?? "personal";
    const imageId = createId();
    const fileExtension = file.originalname.split(".").pop() || "png";
    const storageKey = `orgs/${orgId}/inline-uploads/${userId}/${imageId}.${fileExtension}`;

    try {
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      
      // Upload custom object key directly
      await this.storage["client"].send(
        new PutObjectCommand({
          Bucket: this.storage["bucket"],
          Key: storageKey,
          Body: file.buffer,
          ContentType: file.mimetype,
          ContentLength: file.size,
          Metadata: {
            orgId,
            userId,
            isInlineUpload: "true",
          },
        }),
      );

      const signedUrl = await this.storage.getSignedUrl(storageKey, 3600);
      return { storageKey, url: signedUrl };
    } catch (err: any) {
      this.logger.error(`Inline image storage upload error: ${err.message}`);
      throw new BadRequestException("Failed to upload inline image to storage");
    }
  }
}
