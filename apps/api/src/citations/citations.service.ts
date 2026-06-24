import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface Citation {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  pageNumber: number;
  content: string;
}

@Injectable()
export class CitationsService {
  constructor(private prisma: PrismaService) {}

  async enrichCitations(
    chunks: Array<{ chunkId: string; documentId: string; pageNumber: number; content: string }>,
  ): Promise<Citation[]> {
    if (!chunks || chunks.length === 0) {
      return [];
    }

    const documentIds = Array.from(new Set(chunks.map((c) => c.documentId)));

    // Fetch documents to map their titles/originalNames
    const documents = await this.prisma.document.findMany({
      where: {
        id: { in: documentIds },
      },
      select: {
        id: true,
        title: true,
        originalName: true,
      },
    });

    const docMap = new Map<string, string>();
    for (const doc of documents) {
      docMap.set(doc.id, doc.title || doc.originalName);
    }

    return chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      documentTitle: docMap.get(chunk.documentId) || 'Unknown Document',
      pageNumber: chunk.pageNumber || 1,
      content: chunk.content,
    }));
  }
}
