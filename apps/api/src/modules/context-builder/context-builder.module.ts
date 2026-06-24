import { Module } from '@nestjs/common';
import { ContextBuilderService } from './context-builder.service';
import { MemoryModule } from '../memory/memory.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { SynthesisModule } from '../synthesis/synthesis.module';

@Module({
  imports: [MemoryModule, RetrievalModule, SynthesisModule],
  providers: [ContextBuilderService],
  exports: [ContextBuilderService],
})
export class ContextBuilderModule {}
