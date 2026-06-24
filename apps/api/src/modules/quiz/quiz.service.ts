import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MultiDocRetrievalService } from '../retrieval/multi-doc.retrieval';
import { GenerateQuizDto, SubmitQuizDto } from './quiz.types';
import { MessageRole } from '@prisma/client';
import { AnalyticsService } from '../analytics/analytics.service';

@Injectable()
export class QuizService {
  private readonly logger = new Logger(QuizService.name);
  private readonly aiServiceUrl: string;

  constructor(
    private prisma: PrismaService,
    private multiDocRetrievalService: MultiDocRetrievalService,
    private configService: ConfigService,
    private analyticsService: AnalyticsService,
  ) {
    this.aiServiceUrl = this.configService.get<string>(
      'NEXT_PUBLIC_AI_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  /**
   * Generates a quiz from documents in a conversation.
   * Chunks are fetched via MultiDocRetrieval and sent to the FastAPI service to generate structured questions.
   */
  async generateQuiz(userId: string, tenantId: string, dto: GenerateQuizDto) {
    const { conversationId, documentIds, difficulty, count } = dto;

    // 1. Verify conversation access and get context
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

    const topicQuery = lastUserMessage?.content || conversation.title || 'General Knowledge';
    this.logger.log(`Generating quiz on topic: "${topicQuery}" with difficulty ${difficulty}`);

    // 3. Retrieve chunks across multiple documents
    const groupedChunks = await this.multiDocRetrievalService.retrieveMultiDoc(
      topicQuery,
      tenantId,
      documentIds,
      15, // Retrieve up to 15 chunks to generate a high-quality quiz
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

    // 4. Send request to FastAPI Quiz Generator endpoint
    const url = `${this.aiServiceUrl}/ai/study/quiz/generate`;
    this.logger.log(`Calling FastAPI quiz generator at: ${url}`);

    let generatedQuestions: any[] = [];
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: topicQuery,
          chunks: flatChunks.map((c) => ({
            chunkId: c.chunkId,
            text: c.text,
            score: c.score,
            documentId: c.documentId,
            pageNumber: c.pageNumber,
            documentTitle: c.documentTitle,
          })),
          difficulty,
          count,
        }),
      });

      if (!response.ok) {
        throw new Error(`FastAPI response failed: ${response.statusText}`);
      }

      const result = await response.json();
      generatedQuestions = result.questions || [];
    } catch (err: any) {
      this.logger.error(`Failed to generate quiz questions via AI service: ${err.message}`);
      throw new BadRequestException(`Quiz generation service is currently unavailable: ${err.message}`);
    }

    if (generatedQuestions.length === 0) {
      throw new BadRequestException('AI service did not generate any quiz questions.');
    }

    // 5. Save Quiz and QuizQuestions in PostgreSQL
    const quizTitle = `Quiz: ${topicQuery.slice(0, 30)}${topicQuery.length > 30 ? '...' : ''}`;
    const quiz = await this.prisma.quiz.create({
      data: {
        userId,
        tenantId,
        conversationId,
        title: quizTitle,
        difficulty,
        questions: {
          create: generatedQuestions.map((q) => ({
            type: q.type,
            question: q.question,
            options: q.options ? JSON.parse(JSON.stringify(q.options)) : undefined,
            answer: q.answer,
            explanation: q.explanation,
            chunkIdSource: q.chunkIdSource || '',
          })),
        },
      },
      include: {
        questions: true,
      },
    });

    this.logger.log(`Successfully created Quiz id ${quiz.id} with ${quiz.questions.length} questions.`);
    return quiz;
  }

  /**
   * Fetches a quiz by ID, enforcing tenant isolation.
   */
  async getQuiz(userId: string, tenantId: string, quizId: string) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        questions: true,
      },
    });

    if (!quiz) {
      throw new NotFoundException('Quiz not found');
    }

    if (quiz.tenantId !== tenantId) {
      throw new ForbiddenException('Tenant access denied');
    }

    return quiz;
  }

  /**
   * Lists all quizzes for a user/tenant.
   */
  async listQuizzes(userId: string, tenantId: string) {
    return this.prisma.quiz.findMany({
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
   * Submits a quiz score and logs the attempt in the analytics system.
   */
  async submitQuiz(userId: string, tenantId: string, quizId: string, dto: SubmitQuizDto) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
    });

    if (!quiz) {
      throw new NotFoundException('Quiz not found');
    }

    if (quiz.tenantId !== tenantId) {
      throw new ForbiddenException('Tenant access denied');
    }

    return this.analyticsService.logQuizAttempt(userId, tenantId, {
      quizId,
      correctAnswers: dto.correctAnswers,
      wrongAnswers: dto.wrongAnswers,
    });
  }
}
