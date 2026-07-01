import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface QdrantSearchResult {
  id: string | number;
  score: number;
  payload: {
    chunkId?: string;
    documentId: string;
    userId: string;
    pageNumber: number;
    chunkIndex: number;
    fileType: string;
    content: string;
    tenantId?: string;
  };
  vector?: number[];
}

@Injectable()
export class QdrantClient {
  private readonly logger = new Logger(QdrantClient.name);
  private readonly qdrantUrl: string;
  private readonly collectionName = 'document_chunks';

  constructor(private configService: ConfigService) {
    const host = this.configService.get<string>('QDRANT_HOST', 'localhost');
    const port = this.configService.get<string>('QDRANT_PORT', '6333');
    this.qdrantUrl = `http://${host}:${port}`;
  }

  async search(
    vector: number[],
    tenantId: string,
    documentIds?: string[],
    limit = 10,
    withVector = false,
  ): Promise<QdrantSearchResult[]> {
    const url = `${this.qdrantUrl}/collections/${this.collectionName}/points/search`;

    // 1. Build strict multi-tenant and document metadata filters
    const mustConditions: any[] = [];

    // Filter by tenantId.
    // In our payload, we check both 'tenantId' and 'userId' to ensure seamless local testing fallback
    mustConditions.push({
      should: [
        { key: 'tenantId', match: { value: tenantId } },
        { key: 'userId', match: { value: tenantId } }, // fallback for dev setup
      ],
    });

    // Filter by documentIds if provided
    if (documentIds && documentIds.length > 0) {
      if (documentIds.length === 1) {
        mustConditions.push({
          key: 'documentId',
          match: { value: documentIds[0] },
        });
      } else {
        mustConditions.push({
          should: documentIds.map((docId) => ({
            key: 'documentId',
            match: { value: docId },
          })),
        });
      }
    }

    const payload = {
      vector,
      limit,
      filter: {
        must: mustConditions,
      },
      with_payload: true,
      with_vector: withVector,
    };

    try {
      this.logger.log(`Searching Qdrant collection: '${this.collectionName}' with limit ${limit}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        this.logger.error(`Qdrant search request failed: ${res.status} - ${errText}`);
        throw new Error(`Qdrant error: ${res.statusText}`);
      }

      const body = await res.json();
      return body.result || [];
    } catch (err: any) {
      this.logger.error(`Failed to execute Qdrant search: ${err.message}`);
      throw err;
    }
  }

  async deletePointsByUserId(userId: string): Promise<void> {
    const url = `${this.qdrantUrl}/collections/${this.collectionName}/points/delete`;
    const payload = {
      filter: {
        must: [
          {
            key: "userId",
            match: { value: userId },
          },
        ],
      },
    };

    try {
      this.logger.log(`Deleting points for userId: ${userId} in Qdrant`);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        this.logger.error(`Qdrant delete points request failed: ${res.status} - ${errText}`);
        throw new Error(`Qdrant error: ${res.statusText}`);
      }
    } catch (err: any) {
      this.logger.error(`Failed to execute Qdrant points deletion: ${err.message}`);
      throw err;
    }
  }
}
