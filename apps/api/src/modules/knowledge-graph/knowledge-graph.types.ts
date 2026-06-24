import { IsString, IsArray, IsOptional, IsNumber, Min, Max, ArrayNotEmpty } from 'class-validator';

// ─── Request DTOs ────────────────────────────────────────────────────

export class ChunkInputDto {
  @IsString()
  id!: string;

  @IsString()
  content!: string;
}

export class BuildGraphDto {
  @IsString()
  documentId!: string;

  @IsArray()
  @ArrayNotEmpty()
  chunks!: ChunkInputDto[];
}

export class ExpandQueryDto {
  @IsString()
  query!: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(3)
  maxHops?: number;
}

// ─── Internal types returned by FastAPI ──────────────────────────────

export interface ExtractedConcept {
  name: string;        // normalized lowercase
  displayName: string; // original casing
  confidence: number;
}

export interface ExtractedRelation {
  fromConcept: string;
  toConcept: string;
  relationType: 'EXPLAINS' | 'RELATED_TO' | 'PREREQUISITE_OF' | 'PART_OF';
  weight: number;
}

export interface ChunkExtractionResult {
  chunkId: string;
  concepts: ExtractedConcept[];
  relations: ExtractedRelation[];
}

export interface GraphExtractResponse {
  results: ChunkExtractionResult[];
}

// ─── API response shapes ─────────────────────────────────────────────

export interface GraphConceptNode {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  confidence: number;
  neighbors: GraphEdge[];
}

export interface GraphEdge {
  conceptId: string;
  conceptName: string;
  conceptDisplayName: string;
  relationType: string;
  weight: number;
  direction: 'outgoing' | 'incoming';
}

