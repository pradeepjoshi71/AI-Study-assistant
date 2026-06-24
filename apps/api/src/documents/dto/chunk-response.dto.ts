export class ChunkResponseDto {
  id!: string;
  documentId!: string;
  chunkIndex!: number;
  content!: string;
  tokenCount!: number;
  metadata!: any;
  createdAt!: Date;

  static fromEntity(entity: any): ChunkResponseDto {
    return {
      id: entity.id,
      documentId: entity.documentId,
      chunkIndex: entity.chunkIndex,
      content: entity.content,
      tokenCount: entity.tokenCount,
      metadata: entity.metadata,
      createdAt: entity.createdAt,
    };
  }
}
