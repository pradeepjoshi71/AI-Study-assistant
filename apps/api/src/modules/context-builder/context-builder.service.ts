import { Injectable, Logger, Optional } from '@nestjs/common';
import { MemoryService } from '../memory/memory.service';
import { MultiDocRetrievalService, RetrievedChunkWithTitle } from '../retrieval/multi-doc.retrieval';
import { SynthesisService } from '../synthesis/synthesis.service';
import { KnowledgeGraphService } from '../knowledge-graph/knowledge-graph.service';
import { ContextBuilderInput, ContextBuilderOutput } from './context.types';

@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name);

  constructor(
    private memoryService: MemoryService,
    private multiDocRetrievalService: MultiDocRetrievalService,
    private synthesisService: SynthesisService,
    @Optional() private knowledgeGraphService: KnowledgeGraphService,
  ) {}

  async buildContext(input: ContextBuilderInput): Promise<ContextBuilderOutput> {
    const { conversationId, userQuery, documentIds, tenantId, userId } = input;
    this.logger.log(`Building context for conversation: ${conversationId} (tenant: ${tenantId})`);

    // A) Fetch conversation memory (caching and summary handled inside MemoryService)
    const { shortTermMessages, longTermSummary } = await this.memoryService.getContextMemory(
      conversationId,
      userId,
      tenantId,
    );

    // B) Optional: expand query using Knowledge Graph BFS traversal
    //    If no graph exists for this tenant, expandQuery safely returns []
    let enrichedQuery = userQuery;
    if (this.knowledgeGraphService) {
      try {
        const expandedTerms = await this.knowledgeGraphService.expandQuery(
          userQuery,
          tenantId,
          2, // max 2 hops
        );
        if (expandedTerms.length > 0) {
          enrichedQuery = [userQuery, ...expandedTerms].join(' ');
          this.logger.debug(
            `Query expanded for tenant=${tenantId}: added [${expandedTerms.join(', ')}]`,
          );
        }
      } catch (err: any) {
        // Graph expansion failure must never block the chat pipeline
        this.logger.warn(`Graph query expansion failed (non-blocking): ${err.message}`);
      }
    }

    // C) Call MultiDocRetrievalService with (optionally enriched) query
    const groupedChunks = await this.multiDocRetrievalService.retrieveMultiDoc(
      enrichedQuery,
      tenantId,
      documentIds,
      10, // target top-10 chunks total
    );

    // D) Flatten grouped chunks for downstream mapping compatibility
    const retrievedChunks: RetrievedChunkWithTitle[] = [];
    for (const docId of Object.keys(groupedChunks)) {
      retrievedChunks.push(...groupedChunks[docId]);
    }

    // E) Call SynthesisService to compile context and resolve contradictions
    const { synthesizedContext, conflicts } = await this.synthesisService.synthesize(
      groupedChunks,
      userQuery,
    );

    return {
      query: userQuery,
      chatHistorySummary: longTermSummary,
      recentMessages: shortTermMessages,
      retrievedChunks,
      groupedChunks,
      synthesizedContext,
      conflicts,
      metadata: {
        tenantId,
        userId,
        conversationId,
        documentIdsFiltered: documentIds,
      },
    };
  }
}
