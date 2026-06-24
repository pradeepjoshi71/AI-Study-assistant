import { Injectable, Logger } from '@nestjs/common';
import { GroupedChunks } from '../retrieval/multi-doc.retrieval';

@Injectable()
export class ConflictResolver {
  private readonly logger = new Logger(ConflictResolver.name);

  /**
   * Scans retrieved chunks across documents for potential contradictions or discrepancies.
   * This is a rule-based check that complements LLM synthesis.
   */
  detectContradictions(groupedChunks: GroupedChunks): string[] {
    const findings: string[] = [];
    const docIds = Object.keys(groupedChunks);
    if (docIds.length < 2) return findings;

    this.logger.log(`Running rule-based conflict resolution across ${docIds.length} documents...`);

    // We look for contrasting assertions on key terms across documents.
    // Example: Document A says X "increases" while Document B says X "decreases"
    const termMappings = new Map<string, { docTitle: string; snippet: string; polarity: 'pos' | 'neg' | 'unknown' }[]>();

    const polarities = [
      { term: 'increase', type: 'pos' as const },
      { term: 'decrease', type: 'neg' as const },
      { term: 'upward', type: 'pos' as const },
      { term: 'downward', type: 'neg' as const },
      { term: 'accelerate', type: 'pos' as const },
      { term: 'decelerate', type: 'neg' as const },
      { term: 'higher', type: 'pos' as const },
      { term: 'lower', type: 'neg' as const },
    ];

    for (const docId of docIds) {
      const chunks = groupedChunks[docId];
      if (!chunks || chunks.length === 0) continue;
      const docTitle = chunks[0].documentTitle;

      for (const chunk of chunks) {
        const text = chunk.text.toLowerCase();
        // Simple sentence tokenizer by period
        const sentences = text.split(/[.!?]/);

        for (const sentence of sentences) {
          // Identify potential nouns/topics in the sentence
          // (e.g., "temperature", "inflation", "revenue", "velocity", "pressure")
          const targetTopics = ['temperature', 'inflation', 'revenue', 'velocity', 'pressure', 'rate', 'cost', 'growth'];
          
          for (const topic of targetTopics) {
            if (sentence.includes(topic)) {
              // Check if sentence contains polarity words
              for (const p of polarities) {
                if (sentence.includes(p.term)) {
                  if (!termMappings.has(topic)) {
                    termMappings.set(topic, []);
                  }
                  
                  // Avoid adding duplicate claims for the same document
                  const existingClaims = termMappings.get(topic)!;
                  const alreadyHasClaim = existingClaims.some(c => c.docTitle === docTitle && c.polarity === p.type);
                  
                  if (!alreadyHasClaim) {
                    existingClaims.push({
                      docTitle,
                      snippet: sentence.trim(),
                      polarity: p.type,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }

    // Now analyze findings: if the same topic has opposite polarities in different documents, flag it
    for (const [topic, claims] of termMappings.entries()) {
      if (claims.length >= 2) {
        // Check if there are opposite polarities
        const hasPos = claims.some(c => c.polarity === 'pos');
        const hasNeg = claims.some(c => c.polarity === 'neg');

        if (hasPos && hasNeg) {
          const posClaim = claims.find(c => c.polarity === 'pos')!;
          const negClaim = claims.find(c => c.polarity === 'neg')!;
          
          findings.push(
            `Potential contradiction detected regarding topic "${topic}": ` +
            `"${posClaim.docTitle}" asserts an increase/upward trend ("...${posClaim.snippet}..."), ` +
            `whereas "${negClaim.docTitle}" asserts a decrease/downward trend ("...${negClaim.snippet}...").`
          );
        }
      }
    }

    return findings;
  }
}
