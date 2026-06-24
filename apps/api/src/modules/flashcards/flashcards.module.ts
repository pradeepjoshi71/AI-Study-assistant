import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { FlashcardService } from './flashcards.service';
import { FlashcardController } from './flashcards.controller';

@Module({
  imports: [PrismaModule, RetrievalModule, ConfigModule],
  providers: [FlashcardService],
  controllers: [FlashcardController],
  exports: [FlashcardService],
})
export class FlashcardModule {}
