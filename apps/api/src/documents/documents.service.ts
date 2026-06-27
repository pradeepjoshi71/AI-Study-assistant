import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { S3Service } from "../storage/s3.service";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { Document, DocumentStatus } from "@prisma/client";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { userContextStorage } from "../common/context/user-context";

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private prisma: PrismaService,
    private s3Service: S3Service,
    @InjectQueue("document-processing") private documentQueue: Queue,
    private eventEmitter: EventEmitter2,
  ) {}

  async upload(
    file: Express.Multer.File,
    userId: string,
    customTitle?: string,
  ): Promise<Document> {
    if (!file) {
      throw new BadRequestException("No file provided");
    }

    this.logger.log(
      `Starting file upload for user: ${userId}, file: ${file.originalname}`,
    );

    // 1. Upload to S3
    let s3Result;
    try {
      s3Result = await this.s3Service.uploadFile(file, userId);
    } catch (err: any) {
      this.logger.error(`S3 Upload error: ${err.message}`);
      throw new BadRequestException("Failed to upload file to storage");
    }

    const title = customTitle || file.originalname;
    const fileExtension = file.originalname.split(".").pop() || "";

    // 2. Save Document metadata in PostgreSQL
    const document = await this.prisma.document.create({
      data: {
        userId,
        title,
        originalName: file.originalname,
        fileType: fileExtension.toUpperCase(),
        mimeType: file.mimetype,
        fileSize: file.size,
        fileUrl: s3Result.url,
        storageKey: s3Result.key,
        status: DocumentStatus.UPLOADED,
        pageCount: 0, // Placeholder, updated in worker step if PDF
        orgId: userContextStorage.getStore()?.orgId || null,
      },
    });

    // 3. Dispatch BullMQ background processing job
    try {
      await this.documentQueue.add("process-document", {
        documentId: document.id,
      });
      this.logger.log(`Dispatched processing job for document: ${document.id}`);
    } catch (err: any) {
      this.logger.error(
        `Failed to dispatch BullMQ job for document: ${document.id}. Error: ${err.message}`,
      );
      // Don't fail the upload request, the worker can poll or database admin can retry
    }

    // 4. Emit event for event-driven invalidation of RAG cache
    this.eventEmitter.emit("document.uploaded", {
      userId,
      documentId: document.id,
    });

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
    const document = await this.prisma.document.findUnique({
      where: { id },
    });

    if (!document) {
      throw new NotFoundException("Document not found");
    }

    const orgId = userContextStorage.getStore()?.orgId;
    if (orgId) {
      if (document.orgId !== orgId) {
        throw new ForbiddenException("You do not have access to this document");
      }
    } else if (document.userId !== userId) {
      throw new ForbiddenException("You do not have access to this document");
    }

    return document;
  }

  async delete(
    id: string,
    userId: string,
  ): Promise<{ success: boolean; message: string }> {
    const document = await this.findOne(id, userId);

    this.logger.log(`Deleting file from S3: Key ${document.storageKey}`);
    try {
      await this.s3Service.deleteFile(document.storageKey);
    } catch (err: any) {
      this.logger.error(`S3 Delete error: ${err.message}`);
      // Continue to delete from DB even if S3 fails to avoid orphan records in DB
    }

    await this.prisma.document.delete({
      where: { id },
    });

    return { success: true, message: "Document deleted successfully" };
  }

  async findChunks(id: string, userId: string) {
    // 1. Validate ownership
    await this.findOne(id, userId);

    // 2. Fetch chunks
    return this.prisma.documentChunk.findMany({
      where: { documentId: id },
      orderBy: { chunkIndex: "asc" },
    });
  }

  async findStatus(id: string, userId: string) {
    const doc = await this.findOne(id, userId);
    return {
      status: doc.status,
      error: doc.processingError,
      startedAt: doc.processingStartedAt,
      completedAt: doc.processingCompletedAt,
    };
  }

  async findMetadata(id: string, userId: string) {
    const doc = await this.findOne(id, userId);
    return {
      originalName: doc.originalName,
      fileSize: doc.fileSize,
      mimeType: doc.mimeType,
      fileUrl: doc.fileUrl,
      storageKey: doc.storageKey,
      pageCount: doc.pageCount,
      extractedTextLength: doc.extractedTextLength,
    };
  }
}
