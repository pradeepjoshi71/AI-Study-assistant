import { DocumentStatus } from "@prisma/client";

export class DocumentResponseDto {
  id!: string;
  userId!: string;
  title!: string;
  originalName!: string;
  fileType!: string;
  mimeType!: string;
  fileSize!: number;
  fileUrl!: string;
  status!: DocumentStatus;
  pageCount!: number;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(entity: any): DocumentResponseDto {
    return {
      id: entity.id,
      userId: entity.userId,
      title: entity.title,
      originalName: entity.originalName,
      fileType: entity.fileType,
      mimeType: entity.mimeType,
      fileSize: entity.fileSize,
      fileUrl: entity.fileUrl,
      status: entity.status,
      pageCount: entity.pageCount,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
