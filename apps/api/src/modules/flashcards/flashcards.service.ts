import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MultiDocRetrievalService } from '../retrieval/multi-doc.retrieval';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { GenerateFlashcardsDto, SubmitFlashcardReviewDto } from './flashcards.types';
import { MessageRole } from '@prisma/client';
import { AnalyticsService } from '../analytics/analytics.service';

@Injectable()
export class FlashcardService {
  private readonly logger = new Logger(FlashcardService.name);
  private readonly aiServiceUrl: string;

  constructor(
    private prisma: PrismaService,
    private multiDocRetrievalService: MultiDocRetrievalService,
    private configService: ConfigService,
    private analyticsService: AnalyticsService,
    @InjectQueue('adaptive-mastery') private readonly masteryQueue: Queue,
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

  /**
   * Submits a flashcard review rating and logs it in the analytics system.
   */
  async submitReview(userId: string, tenantId: string, flashcardId: string, dto: SubmitFlashcardReviewDto) {
    const card = await this.prisma.flashcard.findUnique({
      where: { id: flashcardId },
      include: { deck: true }
    });

    if (!card) {
      throw new NotFoundException('Flashcard not found');
    }

    if (card.deck.tenantId !== tenantId) {
      throw new ForbiddenException('Tenant access denied');
    }

    const result = await this.analyticsService.logFlashcardReview(userId, tenantId, {
      flashcardId,
      recallStatus: dto.recallStatus,
    });

    // Spaced Repetition (SR) SM-2 algorithm update
    // If client does not send score, map from recallStatus: easy=5, hard=3, fail=0
    let sm2Score = dto.score ?? 3;
    if (dto.score === undefined) {
      if (dto.recallStatus === "easy") sm2Score = 5;
      else if (dto.recallStatus === "fail") sm2Score = 0;
    }

    let easeFactor = card.easeFactor;
    let interval = card.interval;

    if (sm2Score < 3) {
      interval = 1;
    } else {
      if (interval === 1) {
        interval = 6;
      } else {
        interval = Math.round(interval * easeFactor);
      }
      
      // easeFactor calculation formula:
      // EF' = EF + (0.1 - (5 - score) * (0.08 + (5 - score) * 0.02))
      easeFactor = easeFactor + 0.1 - (5 - sm2Score) * (0.08 + (5 - sm2Score) * 0.02);
      easeFactor = Math.max(1.3, easeFactor); // Cap easeFactor min 1.3
    }

    const nextReviewDate = new Date();
    nextReviewDate.setDate(nextReviewDate.getDate() + interval);

    // Save SM-2 progress metrics back to PostgreSQL
    await this.prisma.flashcard.update({
      where: { id: flashcardId },
      data: {
        easeFactor,
        interval,
        nextReviewDate,
      },
    });

    // Schedule BullMQ delayed job at nextReviewDate to add card back to user review queue
    try {
      const delayMs = Math.max(0, nextReviewDate.getTime() - Date.now());
      // Re-use current masteryQueue connection details to schedule review task
      const reviewQueue = new Queue("badge-check", { connection: (this.masteryQueue as any).opts.connection });
      await reviewQueue.add("flashcard-review-due", { userId, flashcardId }, { delay: delayMs });
      this.logger.log(`Scheduled card review job for card ${flashcardId} (delay: ${Math.round(delayMs / 1000)}s)`);
      await reviewQueue.close();
    } catch (wsErr: any) {
      this.logger.warn(`Failed to schedule card review job: ${wsErr.message}`);
    }

    // Determine performance score from review recall rating: easy=100%, hard=50%, fail=0%
    let score = 0;
    if (dto.recallStatus === "easy") score = 100;
    else if (dto.recallStatus === "hard") score = 50;

    // Resolve previous attempt count to update attemptNumber sequence
    const attemptsCount = await this.prisma.flashcardReview.count({
      where: { userId, flashcardId },
    });

    // Enqueue background mastery and analytics updater
    await this.masteryQueue.add("process-performance-mastery", {
      userId,
      orgId: card.deck.orgId || null,
      itemId: flashcardId,
      itemType: "FLASHCARD",
      score,
      timeTakenMs: 0,
      attemptNumber: attemptsCount || 1,
      difficulty: 1.0, // Default base card difficulty
    }).catch(err => {
      this.logger.warn(`Failed to dispatch adaptive-mastery queue job: ${err.message}`);
    });

    return result;
  }

  /**
   * Returns flashcard reviews due today (nextReviewDate <= now) up to a max limit of 20 items.
   */
  async getReviewQueue(userId: string) {
    return this.prisma.flashcard.findMany({
      where: {
        deck: {
          userId,
        },
        nextReviewDate: {
          lte: new Date(),
        },
      },
      take: 20,
      orderBy: {
        nextReviewDate: "asc",
      },
    });
  }
}
