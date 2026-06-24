import { Module } from '@nestjs/common';
import { PromptEngineService } from './prompt-engine.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [PromptEngineService],
  exports: [PromptEngineService],
})
export class PromptEngineModule {}
