import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  userId: string;
  pageNumber: number;
  chunkIndex: number;
  fileType: string;
  content: string;
  score: number;
  relevanceScore?: number;
  combinedScore?: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  context: string;
  sources: Array<{ documentId: string; originalName: string }>;
  pages: number[];
}

@Injectable()
export class RetrievalService {
  private readonly aiServiceUrl: string;
  private readonly logger = new Logger(RetrievalService.name);

  constructor(private configService: ConfigService) {
    this.aiServiceUrl = this.configService.get<string>('NEXT_PUBLIC_AI_SERVICE_URL', 'http://localhost:8000');
  }

  async retrieveContext(
    userId: string,
    query: string,
    documentIds?: string[],
    storageKey?: string,
  ): Promise<RetrievalResult> {
    this.logger.log(`Retrieving context from AI service for query: "${query}" (user: ${userId})`);
    
    // Choose RAG search target based on visual query storageKey parameter:
    // If user uploaded an image attachment, query the new multimodal RAG route
    const hasImage = !!storageKey;
    const path = hasImage ? "/ai/rag/search/multimodal" : "/ai/rag/search";
    
    try {
      const response = await fetch(`${this.aiServiceUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          query,
          documentIds: documentIds && documentIds.length > 0 ? documentIds : undefined,
          orgId: "personal", // Default value
          storageKey,        // Forward inline image attachment key
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`AI service retrieval failed: ${response.status} - ${errorText}`);
        throw new InternalServerErrorException('Retrieval service failed');
      }

      const data = await response.json();
      
      // Map multimodal chunks properties to conform to RetrievedChunk interface
      const rawChunks = data.chunks || [];
      const mappedChunks = rawChunks.map((c: any) => ({
        chunkId: c.chunkId || c.id,
        documentId: c.docId || c.documentId,
        userId: c.userId || userId,
        pageNumber: c.pageRef || c.page || 1,
        chunkIndex: c.chunkIndex || 0,
        fileType: c.modality || "TEXT",
        content: c.text || c.caption || "",
        score: c.final_score || c.score || 0.0,
        // Carry image properties so they propagate to citations
        modality: c.modality,
        storageKey: c.storageKey,
        caption: c.caption,
      }));

      // Generate merged context string if not returned by multimodal RAG search
      let contextStr = data.context || "";
      if (hasImage && !contextStr) {
        contextStr = mappedChunks.map((c: any) => c.content).join("\n\n---\n\n");
      }

      // Generate sources list if missing
      const sourcesList = data.sources || [];
      if (hasImage && sourcesList.length === 0) {
        const docIdsSet = new Set<string>(mappedChunks.map((c: any) => c.documentId));
        docIdsSet.forEach((did) => {
          if (did) {
            sourcesList.push({ documentId: did, originalName: `Document ID: ${did}` });
          }
        });
      }

      // Generate pages list if missing
      const pagesList = data.pages || [];
      if (hasImage && pagesList.length === 0) {
        const pagesSet = new Set<number>(mappedChunks.map((c: any) => c.pageNumber));
        pagesList.push(...Array.from(pagesSet).sort());
      }

      return {
        chunks: mappedChunks,
        context: contextStr,
        sources: sourcesList,
        pages: pagesList,
      };
    } catch (err: any) {
      this.logger.error(`Error connecting to AI service retrieval endpoint: ${err.message}`);
      throw new InternalServerErrorException('Retrieval service connection error');
    }
  }
}
