import { Module } from '@nestjs/common';
import { ContextBuilderService } from './context-builder.service';
import { MemoryModule } from '../memory/memory.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { SynthesisModule } from '../synthesis/synthesis.module';
import { KnowledgeGraphModule } from '../knowledge-graph/knowledge-graph.module';

@Module({
  imports: [MemoryModule, RetrievalModule, SynthesisModule, KnowledgeGraphModule],
  providers: [ContextBuilderService],
  exports: [ContextBuilderService],
})
export class ContextBuilderModule {}

