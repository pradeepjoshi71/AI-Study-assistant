import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GroupedChunks } from '../retrieval/multi-doc.retrieval';
import { ConflictResolver } from './conflict-resolver';

export interface SynthesisOutput {
  synthesizedContext: string;
  conflicts: string;
}

@Injectable()
export class SynthesisService {
  private readonly logger = new Logger(SynthesisService.name);
  private readonly aiServiceUrl: string;

  constructor(
    private configService: ConfigService,
    private conflictResolver: ConflictResolver,
  ) {
    this.aiServiceUrl = this.configService.get<string>(
      'NEXT_PUBLIC_AI_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  /**
   * Orchestrates the multi-document synthesis and conflict detection.
   * Calls the FastAPI AI service and merges the output with local rule-based findings.
   */
  async synthesize(groupedChunks: GroupedChunks, query: string): Promise<SynthesisOutput> {
    const docIds = Object.keys(groupedChunks);
    if (docIds.length === 0) {
      return { synthesizedContext: '', conflicts: '' };
    }

    // 1. Run local rule-based conflict detector
    const localContradictions = this.conflictResolver.detectContradictions(groupedChunks);

    // 2. Call FastAPI Synthesis Engine
    const url = `${this.aiServiceUrl}/ai/synthesis/synthesize`;
    this.logger.log(`Calling FastAPI synthesis engine at: ${url}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          groupedChunks,
        }),
      });

      if (!response.ok) {
        throw new Error(`AI Service synthesis request failed: ${response.statusText}`);
      }

      const data = await response.json();
      const aiConflicts = data.conflicts || '';

      // Merge local rule-based findings with AI-detected conflicts
      let mergedConflicts = aiConflicts.trim();
      if (localContradictions.length > 0) {
        const localSection = `[Rule-based warnings]:\n` + localContradictions.map((c) => `- ${c}`).join('\n');
        mergedConflicts = mergedConflicts
          ? `${mergedConflicts}\n\n${localSection}`
          : localSection;
      }

      return {
        synthesizedContext: data.synthesizedContext || '',
        conflicts: mergedConflicts,
      };
    } catch (err: any) {
      this.logger.error(`Error during multi-document synthesis: ${err.message}. Running fallback...`);
      
      // Fallback: merge chunks manually to avoid breaking the RAG flow
      let fallbackContext = '';
      for (const docId of docIds) {
        const chunks = groupedChunks[docId];
        if (chunks.length === 0) continue;
        const title = chunks[0].documentTitle;
        fallbackContext += `DOCUMENT: ${title} (ID: ${docId})\n`;
        fallbackContext += chunks.map((c) => `[${c.chunkId}] (Page ${c.pageNumber}): ${c.text}`).join('\n');
        fallbackContext += `\n\n`;
      }

      const fallbackConflicts = localContradictions.length > 0
        ? `[Rule-based warnings]:\n` + localContradictions.map((c) => `- ${c}`).join('\n')
        : '';

      return {
        synthesizedContext: fallbackContext.trim(),
        conflicts: fallbackConflicts,
      };
    }
  }
}
