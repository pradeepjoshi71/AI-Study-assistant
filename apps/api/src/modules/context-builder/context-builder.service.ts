import { Injectable, Logger } from '@nestjs/common';
import { MemoryService } from '../memory/memory.service';
import { MultiDocRetrievalService, RetrievedChunkWithTitle } from '../retrieval/multi-doc.retrieval';
import { SynthesisService } from '../synthesis/synthesis.service';
import { ContextBuilderInput, ContextBuilderOutput } from './context.types';

@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name);

  constructor(
    private memoryService: MemoryService,
    private multiDocRetrievalService: MultiDocRetrievalService,
    private synthesisService: SynthesisService,
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

    // B) Call MultiDocRetrievalService to retrieve diversified grouped chunks
    const groupedChunks = await this.multiDocRetrievalService.retrieveMultiDoc(
      userQuery,
      tenantId,
      documentIds,
      10, // target top-10 chunks total
    );

    // C) Flatten grouped chunks for downstream mapping compatibility
    const retrievedChunks: RetrievedChunkWithTitle[] = [];
    for (const docId of Object.keys(groupedChunks)) {
      retrievedChunks.push(...groupedChunks[docId]);
    }

    // D) Call SynthesisService to compile context and resolve contradictions
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
