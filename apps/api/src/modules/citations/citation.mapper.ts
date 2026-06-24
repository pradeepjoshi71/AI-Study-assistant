import { Injectable } from '@nestjs/common';
import { RetrievedChunk } from '../retrieval/retrieval.service';
import { EnrichedCitation, Citation } from './citation.types';

@Injectable()
export class CitationMapper {
  mapCitations(
    citations: Citation[],
    retrievedChunks: RetrievedChunk[],
  ): EnrichedCitation[] {
    const chunkMap = new Map<string, RetrievedChunk>();
    for (const chunk of retrievedChunks) {
      chunkMap.set(chunk.chunkId, chunk);
    }

    const enriched: EnrichedCitation[] = [];

    for (const cite of citations) {
      const chunk = chunkMap.get(cite.chunk_id);
      if (chunk) {
        enriched.push({
          chunk_id: cite.chunk_id,
          document_id: chunk.documentId,
          page: chunk.pageNumber,
          text_preview: cite.quote || chunk.text.slice(0, 100),
        });
      }
    }

    return enriched;
  }
}
