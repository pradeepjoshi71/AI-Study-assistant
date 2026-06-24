import { Injectable, Logger } from '@nestjs/common';
import { RetrievalService, RetrievedChunk } from './retrieval.service';
import { QdrantClient, QdrantSearchResult } from './qdrant.client';
import { PrismaService } from '../../prisma/prisma.service';

export interface RetrievedChunkWithTitle extends RetrievedChunk {
  documentTitle: string;
}

export interface GroupedChunks {
  [documentId: string]: RetrievedChunkWithTitle[];
}

@Injectable()
export class MultiDocRetrievalService {
  private readonly logger = new Logger(MultiDocRetrievalService.name);

  constructor(
    private retrievalService: RetrievalService,
    private qdrantClient: QdrantClient,
    private prisma: PrismaService,
  ) {}

  /**
   * Retrieves chunks across multiple documents and applies Max Marginal Relevance (MMR)
   * to ensure source diversity and reduce redundant semantic content.
   */
  async retrieveMultiDoc(
    query: string,
    tenantId: string,
    documentIds?: string[],
    limit = 10,
    lambda = 0.6,
  ): Promise<GroupedChunks> {
    this.logger.log(`Multi-Doc Retrieval: query="${query}" limit=${limit} lambda=${lambda}`);

    // 1. Generate query embedding
    const queryVector = await this.retrievalService.getEmbedding(query);

    // 2. Fetch a larger pool of candidates (e.g., limit * 2.5) with vector embeddings
    const candidateLimit = Math.max(limit * 2.5, 25);
    const candidates = await this.qdrantClient.search(
      queryVector,
      tenantId,
      documentIds,
      candidateLimit,
      true, // withVector = true
    );

    if (candidates.length === 0) {
      return {};
    }

    // 3. Run MMR diversification algorithm
    const selectedResults = this.runMMR(candidates, queryVector, lambda, limit);

    // 4. Resolve document titles from PostgreSQL using Prisma
    const docIds = Array.from(new Set(selectedResults.map((r) => r.payload.documentId)));
    const docTitleMap = new Map<string, string>();

    if (docIds.length > 0) {
      try {
        const documents = await this.prisma.document.findMany({
          where: {
            id: { in: docIds },
          },
          select: {
            id: true,
            title: true,
          },
        });

        for (const doc of documents) {
          docTitleMap.set(doc.id, doc.title);
        }
      } catch (err: any) {
        this.logger.error(`Failed to retrieve document titles from Postgres: ${err.message}`);
      }
    }

    // 5. Limit to top 3-5 unique documents (performance rule)
    // We keep all chunks belonging to the first 5 unique documents encountered in selected order
    const maxUniqueDocs = 5;
    const allowedDocIds = new Set<string>();
    const docDiscoveryOrder: string[] = [];

    for (const r of selectedResults) {
      const docId = r.payload.documentId;
      if (!allowedDocIds.has(docId)) {
        if (allowedDocIds.size < maxUniqueDocs) {
          allowedDocIds.add(docId);
          docDiscoveryOrder.push(docId);
        }
      }
    }

    // Filter results to only those within allowed documents
    const filteredResults = selectedResults.filter((r) =>
      allowedDocIds.has(r.payload.documentId),
    );

    // 6. Group chunks by documentId
    const grouped: GroupedChunks = {};
    for (const res of filteredResults) {
      const docId = res.payload.documentId;
      const docTitle = docTitleMap.get(docId) || 'Untitled Document';
      const chunkId = String(res.payload.chunkId || res.id);

      if (!grouped[docId]) {
        grouped[docId] = [];
      }

      grouped[docId].push({
        chunkId,
        text: res.payload.content || '',
        score: res.score,
        documentId: docId,
        pageNumber: res.payload.pageNumber || 1,
        documentTitle: docTitle,
      });
    }

    return grouped;
  }

  /**
   * Performs the Max Marginal Relevance (MMR) selection process.
   */
  private runMMR(
    candidates: QdrantSearchResult[],
    queryVector: number[],
    lambda: number,
    limit: number,
  ): QdrantSearchResult[] {
    if (candidates.length === 0) return [];

    const selected: QdrantSearchResult[] = [];
    const remaining = [...candidates];

    // Select the first element (highest similarity score)
    const first = remaining.shift();
    if (first) {
      selected.push(first);
    }

    while (selected.length < limit && remaining.length > 0) {
      let bestScore = -Infinity;
      let bestIndex = -1;

      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];
        if (!cand.vector) continue;

        // Use similarity score returned by Qdrant (cosine/dot)
        const simToQuery = cand.score;

        // Calculate maximum similarity to already selected chunks
        let maxSimToSelected = -Infinity;
        for (const sel of selected) {
          if (!sel.vector) continue;
          const sim = this.cosineSimilarity(cand.vector, sel.vector);
          if (sim > maxSimToSelected) {
            maxSimToSelected = sim;
          }
        }

        // Handle case where no selected items had vectors (should not happen)
        if (maxSimToSelected === -Infinity) {
          maxSimToSelected = 0;
        }

        // MMR score calculation
        const score = lambda * simToQuery - (1 - lambda) * maxSimToSelected;

        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }

      if (bestIndex === -1) {
        // Fallback: if vectors are missing, just push the highest scoring remaining candidate
        const nextBest = remaining.shift();
        if (nextBest) {
          selected.push(nextBest);
        } else {
          break;
        }
      } else {
        selected.push(remaining[bestIndex]);
        remaining.splice(bestIndex, 1);
      }
    }

    return selected;
  }

  /**
   * Helper function to calculate cosine similarity between two vector embeddings.
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    const len = Math.min(vecA.length, vecB.length);
    for (let i = 0; i < len; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
