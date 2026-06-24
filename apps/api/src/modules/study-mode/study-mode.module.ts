import { Module } from '@nestjs/common';
import { QuizModule } from '../quiz/quiz.module';
import { FlashcardModule } from '../flashcards/flashcards.module';
import { StudyModeService } from './study-mode.service';
import { StudyModeController } from './study-mode.controller';

@Module({
  imports: [QuizModule, FlashcardModule],
  providers: [StudyModeService],
  controllers: [StudyModeController],
})
export class StudyModeModule {}
