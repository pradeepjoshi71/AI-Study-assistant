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
  ): Promise<RetrievalResult> {
    this.logger.log(`Retrieving context from AI service for query: "${query}" (user: ${userId})`);
    
    try {
      const response = await fetch(`${this.aiServiceUrl}/ai/rag/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          query,
          documentIds: documentIds && documentIds.length > 0 ? documentIds : undefined,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`AI service retrieval failed: ${response.status} - ${errorText}`);
        throw new InternalServerErrorException('Retrieval service failed');
      }

      const data = await response.json();
      return {
        chunks: data.chunks || [],
        context: data.context || '',
        sources: data.sources || [],
        pages: data.pages || [],
      };
    } catch (err: any) {
      this.logger.error(`Error connecting to AI service retrieval endpoint: ${err.message}`);
      throw new InternalServerErrorException('Retrieval service connection error');
    }
  }
}
