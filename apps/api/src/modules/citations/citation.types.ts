export interface Citation {
  chunk_id: string;
  quote: string;
  confidence_score?: number;
}

export interface EnrichedCitation {
  chunk_id: string;
  document_id: string;
  page: number;
  text_preview: string;
}

export interface CitationMapperResult {
  answer: string;
  citations: EnrichedCitation[];
}
