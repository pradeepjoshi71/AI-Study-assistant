import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  BuildGraphDto,
  ChunkInputDto,
  GraphConceptNode,
  GraphEdge,
  GraphExtractResponse,
  ChunkExtractionResult,
} from './knowledge-graph.types';

@Injectable()
export class KnowledgeGraphService {
  private readonly logger = new Logger(KnowledgeGraphService.name);
  private readonly aiServiceUrl: string;
  /** Cache TTL for expanded query results — 1 hour */
  private readonly CACHE_TTL_SECONDS = 3600;
  /** Maximum allowed BFS traversal depth */
  private readonly MAX_HOPS = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.aiServiceUrl = this.config.get<string>(
      'NEXT_PUBLIC_AI_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Triggers async concept extraction from a document's chunks.
   * Calls FastAPI, then upserts Concept nodes, ConceptRelation edges,
   * and ChunkConceptMap rows into PostgreSQL.
   * This method is intentionally fire-and-forget from the controller —
   * it returns immediately so the chat pipeline is never blocked.
   */
  async buildGraph(tenantId: string, dto: BuildGraphDto): Promise<{ queued: number }> {
    const chunksToProcess: ChunkInputDto[] = dto.chunks;
    this.logger.log(
      `buildGraph called for tenant=${tenantId}, document=${dto.documentId}, ` +
      `${chunksToProcess.length} chunks.`,
    );

    // Fire-and-forget: don't await the heavy processing
    this._extractAndPersist(tenantId, chunksToProcess).catch((err) => {
      this.logger.error(`Background graph build failed for tenant=${tenantId}: ${err.message}`);
    });

    return { queued: chunksToProcess.length };
  }

  /**
   * Expands a raw user query into a broader set of related concept terms
   * using BFS traversal of the knowledge graph (up to maxHops deep).
   *
   * Results are Redis-cached for 1 hour per (tenantId, normalizedQuery) pair.
   * Returns [] safely if no graph exists for the tenant (non-blocking).
   */
  async expandQuery(
    query: string,
    tenantId: string,
    maxHops = 2,
  ): Promise<string[]> {
    const clampedHops = Math.min(maxHops, this.MAX_HOPS);
    const cacheKey = `graph:expand:${tenantId}:${this._normalizeKey(query)}`;

    try {
      const client = this.redis.getClient();
      const cached = await client.get(cacheKey);
      if (cached) {
        this.logger.debug(`Cache HIT for graph expansion: ${cacheKey}`);
        return JSON.parse(cached) as string[];
      }
    } catch {
      // Redis failure should never block the query pipeline
    }

    // Find seed concepts that match words in the query
    const queryWords = query
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3);

    const seedConcepts = await this.prisma.concept.findMany({
      where: {
        tenantId,
        name: { in: queryWords },
      },
      select: { id: true, name: true },
    });

    if (seedConcepts.length === 0) {
      return [];
    }

    // BFS traversal
    const visitedIds = new Set<string>(seedConcepts.map((c) => c.id));
    let frontier = seedConcepts.map((c) => c.id);
    const expansionTerms: Map<string, number> = new Map(); // name → max weight seen

    for (let hop = 0; hop < clampedHops; hop++) {
      if (frontier.length === 0) break;

      const relations = await this.prisma.conceptRelation.findMany({
        where: {
          tenantId,
          OR: [
            { fromConceptId: { in: frontier } },
            { toConceptId: { in: frontier } },
          ],
          // Prioritize meaningful relations; skip weak RELATED_TO
          NOT: [{ relationType: 'RELATED_TO', weight: { lt: 0.6 } }],
        },
        include: {
          fromConcept: { select: { id: true, name: true } },
          toConcept: { select: { id: true, name: true } },
        },
      });

      const nextFrontier: string[] = [];

      for (const rel of relations) {
        // Traverse to the concept on the OTHER side of the relation
        const neighbor =
          frontier.includes(rel.fromConceptId) ? rel.toConcept : rel.fromConcept;

        if (!visitedIds.has(neighbor.id)) {
          visitedIds.add(neighbor.id);
          nextFrontier.push(neighbor.id);

          const existing = expansionTerms.get(neighbor.name) ?? 0;
          expansionTerms.set(neighbor.name, Math.max(existing, rel.weight));
        }
      }

      frontier = nextFrontier;
    }

    // Sort by weight descending, take top 10
    const sortedTerms = [...expansionTerms.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]) => name);

    try {
      const client = this.redis.getClient();
      await client.set(cacheKey, JSON.stringify(sortedTerms), 'EX', this.CACHE_TTL_SECONDS);
    } catch {
      // Cache write failure is non-fatal
    }

    this.logger.debug(
      `Query expansion for "${query}" (tenant=${tenantId}): [${sortedTerms.join(', ')}]`,
    );
    return sortedTerms;
  }

  /**
   * Returns a concept node with all its direct neighbors and typed edges.
   * Used by the frontend concept explorer panel.
   */
  async getConceptNetwork(conceptName: string, tenantId: string): Promise<GraphConceptNode> {
    const concept = await this.prisma.concept.findUnique({
      where: { tenantId_name: { tenantId, name: conceptName.toLowerCase().trim() } },
      include: {
        outgoing: {
          include: { toConcept: true },
          orderBy: { weight: 'desc' },
        },
        incoming: {
          include: { fromConcept: true },
          orderBy: { weight: 'desc' },
        },
      },
    });

    if (!concept) {
      throw new NotFoundException(
        `Concept '${conceptName}' not found in the knowledge graph for this tenant.`,
      );
    }

    const neighbors: GraphEdge[] = [
      ...concept.outgoing.map((rel) => ({
        conceptId: rel.toConcept.id,
        conceptName: rel.toConcept.name,
        conceptDisplayName: rel.toConcept.displayName,
        relationType: rel.relationType,
        weight: rel.weight,
        direction: 'outgoing' as const,
      })),
      ...concept.incoming.map((rel) => ({
        conceptId: rel.fromConcept.id,
        conceptName: rel.fromConcept.name,
        conceptDisplayName: rel.fromConcept.displayName,
        relationType: rel.relationType,
        weight: rel.weight,
        direction: 'incoming' as const,
      })),
    ];

    return {
      id: concept.id,
      name: concept.name,
      displayName: concept.displayName,
      description: concept.description,
      confidence: concept.confidence,
      neighbors,
    };
  }

  /**
   * Calls FastAPI /ai/graph/explain to get an AI-generated pedagogical
   * explanation of a concept and its related cluster.
   */
  async explainConcept(conceptName: string, tenantId: string): Promise<string> {
    const concept = await this.prisma.concept.findUnique({
      where: { tenantId_name: { tenantId, name: conceptName.toLowerCase().trim() } },
      include: {
        outgoing: {
          include: { toConcept: { select: { displayName: true } } },
          take: 5,
          orderBy: { weight: 'desc' },
        },
      },
    });

    if (!concept) {
      throw new NotFoundException(`Concept '${conceptName}' not found.`);
    }

    const relatedNames = concept.outgoing.map((r) => r.toConcept.displayName);

    const url = `${this.aiServiceUrl}/ai/graph/explain`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          concept: concept.displayName,
          relatedConcepts: relatedNames,
          tenantId,
        }),
      });
      if (!resp.ok) throw new Error(resp.statusText);
      const data: { explanation: string } = await resp.json();
      return data.explanation;
    } catch (err: any) {
      this.logger.error(`Concept explanation call failed: ${err.message}`);
      return `${concept.displayName} is an important concept. Related: ${relatedNames.join(', ')}.`;
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Private: extraction + persistence
  // ─────────────────────────────────────────────────────────────────────

  private async _extractAndPersist(
    tenantId: string,
    chunks: ChunkInputDto[],
  ): Promise<void> {
    const url = `${this.aiServiceUrl}/ai/graph/extract`;
    this.logger.log(`Calling FastAPI graph extraction at ${url} for ${chunks.length} chunks.`);

    let extraction: GraphExtractResponse;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, chunks }),
      });
      if (!resp.ok) throw new Error(resp.statusText);
      extraction = await resp.json();
    } catch (err: any) {
      this.logger.error(`FastAPI graph extraction failed: ${err.message}`);
      return;
    }

    for (const result of extraction.results) {
      await this._persistChunkResult(tenantId, result);
    }

    this.logger.log(
      `Graph build complete for tenant=${tenantId}: ` +
      `${extraction.results.length} chunks processed.`,
    );
  }

  private async _persistChunkResult(
    tenantId: string,
    result: ChunkExtractionResult,
  ): Promise<void> {
    const { chunkId, concepts, relations } = result;

    // 1. Upsert each concept node
    const conceptIdMap = new Map<string, string>(); // normalizedName → db id

    for (const concept of concepts) {
      if (!concept.name) continue;
      const upserted = await this.prisma.concept.upsert({
        where: { tenantId_name: { tenantId, name: concept.name } },
        create: {
          tenantId,
          name: concept.name,
          displayName: concept.displayName,
          confidence: concept.confidence,
        },
        update: {
          // Boost confidence if re-seen; keep the higher displayName casing
          confidence: { set: Math.max(concept.confidence, 0) },
          displayName: concept.displayName,
        },
        select: { id: true, name: true },
      });
      conceptIdMap.set(upserted.name, upserted.id);
    }

    // 2. Upsert ChunkConceptMap rows
    for (const [name, id] of conceptIdMap) {
      const concept = concepts.find((c) => c.name === name);
      await this.prisma.chunkConceptMap.upsert({
        where: { chunkId_conceptId: { chunkId, conceptId: id } },
        create: { chunkId, conceptId: id, tenantId, confidence: concept?.confidence ?? 1.0 },
        update: {},
      });
    }

    // 3. Upsert ConceptRelation edges
    for (const rel of relations) {
      const fromId = conceptIdMap.get(rel.fromConcept);
      const toId = conceptIdMap.get(rel.toConcept);
      if (!fromId || !toId || fromId === toId) continue;

      await this.prisma.conceptRelation.upsert({
        where: {
          tenantId_fromConceptId_toConceptId_relationType: {
            tenantId,
            fromConceptId: fromId,
            toConceptId: toId,
            relationType: rel.relationType,
          },
        },
        create: {
          tenantId,
          fromConceptId: fromId,
          toConceptId: toId,
          relationType: rel.relationType,
          weight: rel.weight,
        },
        update: { weight: rel.weight },
      });
    }
  }

  private _normalizeKey(text: string): string {
    return text.toLowerCase().replace(/\W+/g, '_').slice(0, 100);
  }
}

