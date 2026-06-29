import { Module } from '@nestjs/common';
import { QuizModule } from '../quiz/quiz.module';
import { FlashcardModule } from '../flashcards/flashcards.module';
import { StudyModeService } from './study-mode.service';
import { StudyModeController } from './study-mode.controller';

import { PrismaModule } from '../../prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [QuizModule, FlashcardModule, PrismaModule, ConfigModule],
  providers: [StudyModeService],
  controllers: [StudyModeController],
})
export class StudyModeModule {}
