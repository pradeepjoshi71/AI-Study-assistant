import { Module } from '@nestjs/common';
import { PromptBuilder } from './prompt.builder';

@Module({
  providers: [PromptBuilder],
  exports: [PromptBuilder],
})
export class PromptEngineModule {}
