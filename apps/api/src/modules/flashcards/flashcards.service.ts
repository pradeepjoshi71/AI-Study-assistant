import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MultiDocRetrievalService } from '../retrieval/multi-doc.retrieval';
import { GenerateFlashcardsDto } from './flashcards.types';
import { MessageRole } from '@prisma/client';

@Injectable()
export class FlashcardService {
  private readonly logger = new Logger(FlashcardService.name);
  private readonly aiServiceUrl: string;

  constructor(
    private prisma: PrismaService,
    private multiDocRetrievalService: MultiDocRetrievalService,
    private configService: ConfigService,
  ) {
    this.aiServiceUrl = this.configService.get<string>(
      'NEXT_PUBLIC_AI_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  /**
   * Generates a spaced-repetition flashcard deck based on conversation document chunks.
   * Sends RAG chunks to the FastAPI service to compile Front/Back question-answer pairs.
   */
  async generateFlashcards(userId: string, tenantId: string, dto: GenerateFlashcardsDto) {
    const { conversationId, mode } = dto;

    // 1. Verify conversation access
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.tenantId !== tenantId) {
      throw new ForbiddenException('Tenant access denied');
    }

    // 2. Fetch last user message in this conversation to act as query topic
    const lastUserMessage = await this.prisma.message.findFirst({
      where: {
        conversationId,
        tenantId,
        role: MessageRole.USER,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const topicQuery = lastUserMessage?.content || conversation.title || 'General Revision';
    this.logger.log(`Generating flashcards deck on topic: "${topicQuery}" under mode ${mode}`);

    // 3. Retrieve chunks across multiple documents
    const groupedChunks = await this.multiDocRetrievalService.retrieveMultiDoc(
      topicQuery,
      tenantId,
      undefined, // retrieve across all documents in conversation
      12, // Retrieve up to 12 chunks
    );

    // Flatten chunks
    const flatChunks = [];
    for (const docId of Object.keys(groupedChunks)) {
      flatChunks.push(...groupedChunks[docId]);
    }

    if (flatChunks.length === 0) {
      throw new BadRequestException(
        'No source document chunks retrieved. Please ensure documents are uploaded and processed.',
      );
    }

    // 4. Send request to FastAPI Flashcards Generator endpoint
    const url = `${this.aiServiceUrl}/ai/study/flashcards/generate`;
    this.logger.log(`Calling FastAPI flashcards generator at: ${url}`);

    let generatedCards: any[] = [];
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chunks: flatChunks.map((c) => ({
            chunkId: c.chunkId,
            text: c.text,
            score: c.score,
            documentId: c.documentId,
            pageNumber: c.pageNumber,
            documentTitle: c.documentTitle,
          })),
          mode,
        }),
      });

      if (!response.ok) {
        throw new Error(`FastAPI response failed: ${response.statusText}`);
      }

      const result = await response.json();
      generatedCards = result.flashcards || [];
    } catch (err: any) {
      this.logger.error(`Failed to generate flashcards via AI service: ${err.message}`);
      throw new BadRequestException(`Flashcards generation service is currently unavailable: ${err.message}`);
    }

    if (generatedCards.length === 0) {
      throw new BadRequestException('AI service did not generate any flashcards.');
    }

    // 5. Save Deck and Flashcards in PostgreSQL
    const deckTitle = `Deck: ${topicQuery.slice(0, 30)}${topicQuery.length > 30 ? '...' : ''} (${mode})`;
    const deck = await this.prisma.flashcardDeck.create({
      data: {
        userId,
        tenantId,
        conversationId,
        title: deckTitle,
        flashcards: {
          create: generatedCards.map((fc) => ({
            front: fc.front,
            back: fc.back,
            chunkIdSource: fc.chunk_id_source || fc.chunkIdSource || '',
            tags: fc.tags ? JSON.parse(JSON.stringify(fc.tags)) : undefined,
          })),
        },
      },
      include: {
        flashcards: true,
      },
    });

    this.logger.log(`Successfully created FlashcardDeck id ${deck.id} with ${deck.flashcards.length} cards.`);
    return deck;
  }

  /**
   * Fetches a flashcard deck by ID, enforcing tenant isolation.
   */
  async getDeck(userId: string, tenantId: string, deckId: string) {
    const deck = await this.prisma.flashcardDeck.findUnique({
      where: { id: deckId },
      include: {
        flashcards: true,
      },
    });

    if (!deck) {
      throw new NotFoundException('Flashcard deck not found');
    }

    if (deck.tenantId !== tenantId) {
      throw new ForbiddenException('Tenant access denied');
    }

    return deck;
  }

  /**
   * Lists all flashcard decks for a user/tenant.
   */
  async listDecks(userId: string, tenantId: string) {
    return this.prisma.flashcardDeck.findMany({
      where: {
        userId,
        tenantId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
