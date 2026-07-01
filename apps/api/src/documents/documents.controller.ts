import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  Sse,
  MessageEvent,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { FileInterceptor } from "@nestjs/platform-express";
import { DocumentsService } from "./documents.service";
import { UploadDocumentDto } from "./dto/upload-document.dto";
import { DocumentResponseDto } from "./dto/document-response.dto";
import { ChunkResponseDto } from "./dto/chunk-response.dto";
import { JwtAuthGuard } from "../auth/guards/jwt.guard";
import { Audit } from "../audit/decorators/audit.decorator";
import { AuditInterceptor } from "../audit/interceptors/audit.interceptor";
import { CurrentUser } from "../auth/decorators/current-user.decorator";

import { PrismaService } from "../prisma/prisma.service";
import { BadRequestException } from "@nestjs/common";

@UseGuards(JwtAuthGuard)
@Controller("documents")
@UseInterceptors(AuditInterceptor)
export class DocumentsController {
  constructor(
    private documentsService: DocumentsService,
    private prisma: PrismaService,
  ) {}

  @Post("upload")
  @Audit("document.upload", "document")
  @UseInterceptors(FileInterceptor("file"))
  async uploadFile(
    @CurrentUser("id") userId: string,
    @Body() body: UploadDocumentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    // If we have a URL but no file, process as URL link document
    if (body.url && !file) {
      // Create mock buffer file descriptor for URL
      const mockFile: Express.Multer.File = {
        fieldname: "file",
        originalname: body.url,
        encoding: "7bit",
        mimetype: "text/html",
        size: 0,
        buffer: Buffer.from(""),
        stream: null as any,
        destination: "",
        filename: "",
        path: "",
      };
      
      const document = await this.documentsService.upload(
        mockFile,
        userId,
        body.title || "Webpage",
      );
      
      // Update key to the URL so worker or pipeline service downloads/scrapes the URL
      await this.prisma.document.update({
        where: { id: document.id },
        data: {
          storageKey: body.url,
          mimeType: body.url.includes("youtube.com") || body.url.includes("youtu.be")
            ? "video/youtube"
            : "text/html",
        },
      });

      // Fetch updated document details to return
      const updatedDoc = await this.prisma.document.findUnique({
        where: { id: document.id },
      });
      return DocumentResponseDto.fromEntity(updatedDoc!);
    }

    if (!file) {
      throw new BadRequestException("No file or URL provided");
    }

    // Apply manual checks for file uploads since we bypassed default validation pipeline for URL compatibility
    if (file.size > 20 * 1024 * 1024) {
      throw new BadRequestException("File size exceeds maximum limit of 20MB");
    }

    const document = await this.documentsService.upload(
      file,
      userId,
      body.title,
    );
    return DocumentResponseDto.fromEntity(document);
  }

  @Get()
  async findAll(@CurrentUser("id") userId: string) {
    const documents = await this.documentsService.findAll(userId);
    return documents.map(DocumentResponseDto.fromEntity);
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentUser("id") userId: string) {
    const document = await this.documentsService.findOne(id, userId);
    
    // Compute modality counts for the document processing summary card
    const chunks = await this.prisma.documentChunk.findMany({
      where: { documentId: id },
      include: { _count: { select: { images: true } } },
    });

    const summary = {
      textCount: chunks.filter(c => c.modality === "TEXT").length,
      tableCount: chunks.filter(c => c.modality === "TABLE").length,
      imageCount: chunks.filter(c => c.modality === "IMAGE").length,
      diagramCount: chunks.filter(c => c.modality === "DIAGRAM").length,
    };

    return {
      ...DocumentResponseDto.fromEntity(document),
      summary,
    };
  }

  @Get(":id/assets")
  async getAssets(@Param("id") id: string, @CurrentUser("id") userId: string) {
    return this.documentsService.findAssets(id, userId);
  }

  @Delete(":id")
  @Audit("document.delete", "document")
  async delete(@Param("id") id: string, @CurrentUser("id") userId: string) {
    return this.documentsService.delete(id, userId);
  }

  @Sse(":id/status")
  async getStatus(
    @Param("id") id: string,
    @CurrentUser("id") userId: string,
  ): Promise<Observable<MessageEvent>> {
    // Verify user owns the document first
    await this.documentsService.findOne(id, userId);

    return new Observable<MessageEvent>((subscriber) => {
      // 1. Instantly fetch and emit current state from DB
      this.documentsService
        .findStatus(id, userId)
        .then((curr) => {
          subscriber.next({
            data: {
              documentId: id,
              status: curr.status,
              chunkCount: curr.chunkCount,
              errorMessage: curr.errorMessage,
            },
          } as MessageEvent);
          
          // If status is final (READY or FAILED), we can stop SSE immediately
          if (curr.status === "READY" || curr.status === "FAILED") {
            subscriber.complete();
          }
        })
        .catch((err) => subscriber.error(err));

      // 2. Setup Redis pub/sub subscriber client for real-time updates
      // Create dedicated duplicate connection because subscriber blocks the client
      const configService = new ConfigService();
      const subClient = new Redis({
        host: configService.get<string>("REDIS_HOST", "localhost"),
        port: Number(configService.get<number>("REDIS_PORT", 6379)),
        password: configService.get<string>("REDIS_PASSWORD", "") || undefined,
      });

      subClient.subscribe("document:status_changed").catch((err) => {
        subscriber.error(err);
      });

      subClient.on("message", (channel, message) => {
        if (channel === "document:status_changed") {
          try {
            const data = JSON.parse(message);
            if (data.documentId === id) {
              subscriber.next({
                data: {
                  documentId: id,
                  status: data.status,
                  chunkCount: data.chunkCount,
                  errorMessage: data.errorMessage,
                },
              } as MessageEvent);

              // Complete SSE connection on final status
              if (data.status === "READY" || data.status === "FAILED") {
                subscriber.complete();
              }
            }
          } catch (e) {
            // parse error
          }
        }
      });

      // Cleanup subscription on close
      return () => {
        subClient.disconnect();
      };
    });
  }

  @Get(":id/chunks")
  async getChunks(@Param("id") id: string, @CurrentUser("id") userId: string) {
    const chunks = await this.documentsService.findChunks(id, userId);
    return chunks.map(ChunkResponseDto.fromEntity);
  }

  @Get(":id/metadata")
  async getMetadata(
    @Param("id") id: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.documentsService.findMetadata(id, userId);
  }

  @Post("upload-inline-image")
  @UseInterceptors(FileInterceptor("file"))
  async uploadInlineImage(
    @CurrentUser("id") userId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException("No image file provided");
    }
    return this.documentsService.uploadInlineImage(file, userId);
  }
}
