import { Injectable } from '@nestjs/common';
import { RagPromptInput } from './rag.prompt';
import { SYSTEM_PROMPT_TEMPLATE } from './prompt.templates';

@Injectable()
export class PromptBuilder {
  buildPrompt(input: RagPromptInput): { systemPrompt: string; userPrompt: string } {
    const { query, chatHistory, chatHistorySummary, retrievedChunks, synthesizedContext, conflicts } = input;

    // 1. Build context section (prefer synthesized context, fallback to flat chunk list)
    let contextSection = '';
    if (synthesizedContext) {
      contextSection = synthesizedContext;
    } else if (retrievedChunks.length === 0) {
      contextSection = 'No context available.';
    } else {
      contextSection = retrievedChunks
        .map((chunk) => `- [${chunk.chunkId}] (from Doc: ${chunk.documentId}): ${chunk.text}`)
        .join('\n');
    }

    // 2. Load the standard system prompt template rules
    const systemPrompt = SYSTEM_PROMPT_TEMPLATE;

    // 3. Build user/chat history context
    let historySection = '';
    if (chatHistorySummary) {
      historySection += `CONVERSATION SUMMARY:\n${chatHistorySummary}\n\n`;
    }
    if (chatHistory && chatHistory.length > 0) {
      historySection += 'RECENT MESSAGES:\n';
      historySection += chatHistory
        .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
        .join('\n');
    }

    const userPrompt = `
CONTEXT:
${contextSection}

${conflicts ? `PRE-DETECTED CONFLICTS / CONTRADICTIONS ACROSS SOURCES:\n${conflicts}\n` : ''}

${historySection ? `CHAT HISTORY:\n${historySection}\n` : ''}
USER QUESTION:
${query}
`.trim();

    return {
      systemPrompt,
      userPrompt,
    };
  }
}
