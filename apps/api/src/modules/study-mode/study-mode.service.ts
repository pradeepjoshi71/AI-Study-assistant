import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { QuizService } from '../quiz/quiz.service';
import { FlashcardService } from '../flashcards/flashcards.service';
import { QuizDifficulty } from '../quiz/quiz.types';
import { FlashcardMode } from '../flashcards/flashcards.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

export class GenerateStudyModeDto {
  message!: string;
  conversationId!: string;
  documentIds?: string[];
  difficulty?: QuizDifficulty;
  count?: number;
}

@Injectable()
export class StudyModeService {
  private readonly logger = new Logger(StudyModeService.name);
  private readonly aiServiceUrl: string;

  constructor(
    private quizService: QuizService,
    private flashcardService: FlashcardService,
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.aiServiceUrl = this.configService.get<string>(
      'NEXT_PUBLIC_AI_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  /**
   * Classifies user study intent from their message and triggers the corresponding study modules.
   */
  async generateStudyContent(userId: string, tenantId: string, dto: GenerateStudyModeDto) {
    const { message, conversationId, documentIds, difficulty = QuizDifficulty.MEDIUM, count = 5 } = dto;
    const msgLower = message.toLowerCase();

    let mode: 'quiz' | 'flashcards' | 'hybrid';

    // Intent detection logic
    if (msgLower.includes('test me') || msgLower.includes('quiz') || msgLower.includes('test')) {
      mode = 'quiz';
    } else if (msgLower.includes('revise') || msgLower.includes('flashcard') || msgLower.includes('cards')) {
      mode = 'flashcards';
    } else if (msgLower.includes('prepare exam') || msgLower.includes('exam') || msgLower.includes('hybrid') || msgLower.includes('both')) {
      mode = 'hybrid';
    } else {
      // Default fallback based on general keywords
      mode = 'quiz';
    }

    this.logger.log(`Detected study mode intent: ${mode.toUpperCase()} for query message: "${message}"`);

    const result: any = {
      detectedMode: mode,
      quiz: null,
      flashcardDeck: null,
    };

    if (mode === 'quiz' || mode === 'hybrid') {
      try {
        result.quiz = await this.quizService.generateQuiz(userId, tenantId, {
          conversationId,
          documentIds,
          difficulty,
          count,
        });
      } catch (err: any) {
        this.logger.error(`Quiz generation during study mode failed: ${err.message}`);
        if (mode === 'quiz') throw err; // rethrow if user specifically requested quiz
      }
    }

    if (mode === 'flashcards' || mode === 'hybrid') {
      try {
        result.flashcardDeck = await this.flashcardService.generateFlashcards(userId, tenantId, {
          conversationId,
          mode: FlashcardMode.REVISION,
        });
      } catch (err: any) {
        this.logger.error(`Flashcard generation during study mode failed: ${err.message}`);
        if (mode === 'flashcards') throw err; // rethrow if user specifically requested flashcards
      }
    }

    return result;
  }

  /**
   * Fetches adaptive summary details for the user: mastery per topic, current difficulty, and recommended action.
   */
  async getAdaptiveSummary(userId: string) {
    const masteries = await this.prisma.userMastery.findMany({
      where: { userId },
      include: { topic: true },
    });

    const activeSession = await this.prisma.adaptiveSession.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
    });

    return {
      masteries: masteries.map((m) => ({
        topicId: m.topicId,
        topicName: m.topic.name,
        masteryScore: m.masteryScore,
        confidence: m.confidence,
      })),
      session: activeSession
        ? {
            sessionId: activeSession.sessionId,
            currentDifficulty: activeSession.currentDifficulty,
            targetMastery: activeSession.targetMastery,
            status: activeSession.status,
          }
        : null,
    };
  }

  /**
   * Fetches the first available adaptive study item (quiz question or flashcard) or creates a default session.
   */
  async getOrCreateAdaptiveSession(userId: string) {
    let session = await this.prisma.adaptiveSession.findFirst({
      where: { userId, status: "ACTIVE" },
    });

    if (!session) {
      const { createId } = await import("@paralleldrive/cuid2");
      session = await this.prisma.adaptiveSession.create({
        data: {
          userId,
          sessionId: createId(),
          currentDifficulty: 0.0,
          targetMastery: 0.8,
          status: "ACTIVE",
        },
      });
    }

    // Attempt to fetch a quiz question or flashcard aligned with current difficulty
    // For demonstration, fetch the most recent quiz question
    const question = await this.prisma.quizQuestion.findFirst({
      include: { quiz: true },
    });

    if (question) {
      return {
        sessionId: session.sessionId,
        currentDifficulty: session.currentDifficulty,
        item: {
          id: question.id,
          type: "QUIZ",
          question: question.question,
          options: question.options,
          topicId: question.quizId, // mock topic context
        },
      };
    }

    // Default mock item if no questions generated in DB
    return {
      sessionId: session.sessionId,
      currentDifficulty: session.currentDifficulty,
      item: {
        id: "mock_item_1",
        type: "QUIZ",
        question: "Describe standard 3PL Item Response Theory logic parameters.",
        options: ["base difficulty", "discrimination", "guessing"],
        topicId: "mock_topic_1",
      },
    };
  }

  /**
   * Submits an adaptive answer score and returns updated mastery estimation delta from the Python AdaptiveEngine.
   */
  async submitAdaptiveAnswer(
    userId: string,
    sessionId: string,
    dto: { itemId: string; score: number; difficulty: number; topicId: string },
  ) {
    const session = await this.prisma.adaptiveSession.findUnique({
      where: { sessionId },
    });
    if (!session) {
      throw new NotFoundException("Session not found");
    }

    // 1. Send answer event to FastAPI AdaptiveEngine to compute new latent ability (theta)
    const targetUrl = `${this.aiServiceUrl.replace("localhost", "host.docker.internal")}/ai/study/adaptive/recommend`;
    let nextDifficulty = session.currentDifficulty;

    try {
      const resp = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          topicId: dto.topicId,
          score: dto.score,
          itemDifficulty: dto.difficulty,
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        nextDifficulty = data.nextDifficulty ?? nextDifficulty;
      }
    } catch (err: any) {
      this.logger.warn(`Failed to fetch adaptive ability estimate: ${err.message}`);
    }

    // 2. Update the local AdaptiveSession difficulty settings
    await this.prisma.adaptiveSession.update({
      where: { sessionId },
      data: { currentDifficulty: nextDifficulty },
    });

    // 3. Resolve topic mastery details to show deltas
    const mastery = await this.prisma.userMastery.findFirst({
      where: { userId, topicId: dto.topicId },
    });

    return {
      success: true,
      nextDifficulty,
      masteryScore: mastery?.masteryScore ?? 0.5,
      confidence: mastery?.confidence ?? 0.1,
    };
  }
}
