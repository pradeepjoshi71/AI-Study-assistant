import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from './qdrant.client';

export interface RetrievedChunk {
  chunkId: string;
  text: string;
  score: number;
  documentId: string;
  pageNumber: number;
}

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);
  private readonly geminiApiKey: string;

  constructor(
    private configService: ConfigService,
    private qdrantClient: QdrantClient,
  ) {
    this.geminiApiKey = this.configService.get<string>('GEMINI_API_KEY', '');
  }

  async getEmbedding(text: string): Promise<number[]> {
    const hasKey = this.geminiApiKey && this.geminiApiKey !== 'your_gemini_api_key_here';
    if (!hasKey) {
      this.logger.warn('GEMINI_API_KEY is not configured. Returning deterministic mock embedding.');
      const mockVector: number[] = [];
      let sum = 0;
      for (let i = 0; i < text.length; i++) {
        sum += text.charCodeAt(i);
      }
      for (let i = 0; i < 768; i++) {
        mockVector.push(Math.sin(sum + i) * 0.1);
      }
      return mockVector;
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${this.geminiApiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: {
            parts: [{ text }],
          },
        }),
      });

      if (!res.ok) {
        throw new Error(`Embedding API response error: ${res.statusText}`);
      }

      const body = await res.json();
      if (!body.embedding || !body.embedding.values) {
        throw new Error('Embedding response structure missing values');
      }

      return body.embedding.values;
    } catch (err: any) {
      this.logger.error(`Failed to generate Gemini embedding: ${err.message}`);
      throw err;
    }
  }

  async retrieve(
    query: string,
    tenantId: string,
    documentIds?: string[],
    limit = 10,
  ): Promise<RetrievedChunk[]> {
    this.logger.log(`Retrieving top-${limit} chunks for query: "${query}" (tenant: ${tenantId})`);
    
    // 1. Convert query -> embedding
    const embedding = await this.getEmbedding(query);

    // 2. Query Qdrant via Client
    const points = await this.qdrantClient.search(embedding, tenantId, documentIds, limit);

    // 3. Map to specific response format
    return points.map((point) => ({
      chunkId: String(point.payload.chunkId || point.id),
      text: point.payload.content || '',
      score: point.score,
      documentId: point.payload.documentId || '',
      pageNumber: point.payload.pageNumber || 1,
    }));
  }
}
