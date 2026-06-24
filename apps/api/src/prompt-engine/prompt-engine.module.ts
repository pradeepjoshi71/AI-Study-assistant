import { Module } from '@nestjs/common';
import { PromptEngineService } from './prompt-engine.service';

@Module({
  providers: [PromptEngineService],
  exports: [PromptEngineService],
})
export class PromptEngineModule {}
