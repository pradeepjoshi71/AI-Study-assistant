import { Injectable, OnModuleInit, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PromptTemplateVersion } from '@prisma/client';

@Injectable()
export class PromptOptimizerService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedDefaultPrompts();
  }

  /**
   * Seed default prompt template versions if none exist in the database.
   */
  async seedDefaultPrompts() {
    const counts = await this.prisma.promptTemplateVersion.count();
    if (counts > 0) return;

    const modes = ['study', 'quiz', 'flashcard'];
    const defaultTemplates: Record<string, string> = {
      study: `You are a highly capable AI Study Assistant operating under strict RAG (Retrieval-Augmented Generation) rules.

SYSTEM RULES:
1. Use ONLY the provided context to answer the user's query. Do NOT use any pre-existing external knowledge or make assumptions.
2. If the answer is not fully contained in the provided context, you MUST respond exactly with "Not found in documents". Do not attempt to guess or extrapolate.
3. Every factual statement or claim in your response must be explicitly grounded in the context and MUST include a chunk reference in the format [chunk_id] at the end of the sentence or clause it supports.

MODE: STUDY ASSISTANT MODE
- Act as a helpful academic tutor.
- Explain concepts clearly, break down complex topics, and answer user queries.

{{summary}}

PROVIDED CONTEXT:
{{context}}`,

      quiz: `You are a highly capable AI Study Assistant operating under strict RAG (Retrieval-Augmented Generation) rules.

SYSTEM RULES:
1. Use ONLY the provided context to answer the user's query. Do NOT use any pre-existing external knowledge or make assumptions.
2. If the answer is not fully contained in the provided context, you MUST respond exactly with "Not found in documents". Do not attempt to guess or extrapolate.
3. Every factual statement or claim in your response must be explicitly grounded in the context and MUST include a chunk reference in the format [chunk_id].

MODE: QUIZ MODE
- Act as an interactive quiz tutor.
- Formulate quiz questions based on the context to test the user's knowledge.
- Ask one question or set of questions at a time to keep it interactive.
- Focus on key concepts and definitions from the context.
- Keep the tone encouraging and academic.

{{summary}}

PROVIDED CONTEXT:
{{context}}`,

      flashcard: `You are a highly capable AI Study Assistant operating under strict RAG (Retrieval-Augmented Generation) rules.

SYSTEM RULES:
1. Use ONLY the provided context to answer the user's query. Do NOT use any pre-existing external knowledge or make assumptions.
2. If the answer is not fully contained in the provided context, you MUST respond exactly with "Not found in documents". Do not attempt to guess or extrapolate.
3. Every factual statement or claim in your response must be explicitly grounded in the context and MUST include a chunk reference in the format [chunk_id].

MODE: FLASHCARD MODE
- Act as a flashcard study helper.
- Format your response as a list of clear, concise Q&A flashcards based on the context.
- Keep the front (Question) and back (Answer) of each flashcard distinct and easy to study.

{{summary}}

PROVIDED CONTEXT:
{{context}}`
    };

    for (const mode of modes) {
      await this.prisma.promptTemplateVersion.create({
        data: {
          mode,
          version: 1,
          systemPrompt: defaultTemplates[mode],
          isActive: true,
          accuracyScore: 95.0,
          tokenCount: defaultTemplates[mode].length / 4,
        },
      });
    }
  }

  async getActivePrompt(mode: string): Promise<PromptTemplateVersion | null> {
    return this.prisma.promptTemplateVersion.findFirst({
      where: { mode, isActive: true },
    });
  }

  async createNewVersion(params: {
    mode: string;
    systemPrompt: string;
    accuracyScore?: number;
    tokenCount?: number;
    createdById?: string;
  }): Promise<PromptTemplateVersion> {
    const { mode, systemPrompt, accuracyScore, tokenCount, createdById } = params;

    // Get highest version number
    const lastVersion = await this.prisma.promptTemplateVersion.findFirst({
      where: { mode },
      orderBy: { version: 'desc' },
    });

    const nextVersion = lastVersion ? lastVersion.version + 1 : 1;

    return this.prisma.promptTemplateVersion.create({
      data: {
        mode,
        version: nextVersion,
        systemPrompt,
        isActive: false, // Must be explicitly activated or pass through governance
        accuracyScore: accuracyScore ?? null,
        tokenCount: tokenCount ?? Math.round(systemPrompt.length / 4),
        createdById: createdById ?? null,
      },
    });
  }

  async activateVersion(mode: string, version: number): Promise<PromptTemplateVersion> {
    const target = await this.prisma.promptTemplateVersion.findUnique({
      where: { mode_version: { mode, version } },
    });

    if (!target) {
      throw new NotFoundException(`Prompt version ${version} for mode ${mode} not found`);
    }

    // Set all other versions for this mode to inactive
    await this.prisma.promptTemplateVersion.updateMany({
      where: { mode, isActive: true },
      data: { isActive: false },
    });

    return this.prisma.promptTemplateVersion.update({
      where: { id: target.id },
      data: { isActive: true },
    });
  }

  async listVersions(mode?: string): Promise<PromptTemplateVersion[]> {
    return this.prisma.promptTemplateVersion.findMany({
      where: mode ? { mode } : {},
      orderBy: [{ mode: 'asc' }, { version: 'desc' }],
    });
  }

  async rollback(mode: string): Promise<PromptTemplateVersion> {
    const active = await this.getActivePrompt(mode);
    if (!active) {
      throw new NotFoundException(`No active prompt found for mode ${mode}`);
    }

    // Find the next highest version that is not the current active version
    const previous = await this.prisma.promptTemplateVersion.findFirst({
      where: {
        mode,
        version: { lt: active.version },
      },
      orderBy: { version: 'desc' },
    });

    if (!previous) {
      throw new ConflictException(`No older version available to rollback to for mode ${mode}`);
    }

    await this.activateVersion(mode, previous.version);
    return previous;
  }
}
