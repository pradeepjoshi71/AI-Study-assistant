import { Module } from '@nestjs/common';
import { LearningLoopService } from './learning-loop.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PromptOptimizerModule } from '../prompt-optimizer/prompt-optimizer.module';

@Module({
  imports: [PrismaModule, PromptOptimizerModule],
  providers: [LearningLoopService],
  exports: [LearningLoopService],
})
export class LearningLoopModule {}
