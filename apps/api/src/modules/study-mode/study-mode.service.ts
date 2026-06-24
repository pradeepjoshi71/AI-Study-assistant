import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { QuizService } from '../quiz/quiz.service';
import { FlashcardService } from '../flashcards/flashcards.service';
import { QuizDifficulty } from '../quiz/quiz.types';
import { FlashcardMode } from '../flashcards/flashcards.types';

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

  constructor(
    private quizService: QuizService,
    private flashcardService: FlashcardService,
  ) {}

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
}
