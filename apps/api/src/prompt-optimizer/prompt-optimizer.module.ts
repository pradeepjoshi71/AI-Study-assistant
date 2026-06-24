import { Module } from '@nestjs/common';
import { PromptOptimizerService } from './prompt-optimizer.service';
import { PromptOptimizerController } from './prompt-optimizer.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [PromptOptimizerService],
  controllers: [PromptOptimizerController],
  exports: [PromptOptimizerService],
})
export class PromptOptimizerModule {}
