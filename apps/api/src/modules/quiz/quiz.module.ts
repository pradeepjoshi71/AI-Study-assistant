import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { QuizService } from './quiz.service';
import { QuizController } from './quiz.controller';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [PrismaModule, RetrievalModule, ConfigModule, AnalyticsModule],
  providers: [QuizService],
  controllers: [QuizController],
  exports: [QuizService],
})
export class QuizModule {}
