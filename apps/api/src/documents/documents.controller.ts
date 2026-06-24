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
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { DocumentsService } from "./documents.service";
import { UploadDocumentDto } from "./dto/upload-document.dto";
import { DocumentResponseDto } from "./dto/document-response.dto";
import { ChunkResponseDto } from "./dto/chunk-response.dto";
import { JwtAuthGuard } from "../auth/guards/jwt.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";

@UseGuards(JwtAuthGuard)
@Controller("documents")
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  @Post("upload")
  @UseInterceptors(FileInterceptor("file"))
  async uploadFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          // 20MB file size limit
          new MaxFileSizeValidator({
            maxSize: 20 * 1024 * 1024,
            message: "File size exceeds maximum limit of 20MB",
          }),
          // MIME types for PDF, DOCX, PPTX, TXT, PNG, JPG, JPEG
          new FileTypeValidator({
            fileType:
              "^(image/(jpeg|png)|application/pdf|text/plain|application/vnd.openxmlformats-officedocument.wordprocessingml.document|application/vnd.openxmlformats-officedocument.presentationml.presentation)$",
          }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() body: UploadDocumentDto,
    @CurrentUser("id") userId: string,
  ) {
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
    return DocumentResponseDto.fromEntity(document);
  }

  @Delete(":id")
  async delete(@Param("id") id: string, @CurrentUser("id") userId: string) {
    return this.documentsService.delete(id, userId);
  }

  @Get(":id/status")
  async getStatus(@Param("id") id: string, @CurrentUser("id") userId: string) {
    return this.documentsService.findStatus(id, userId);
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
}
