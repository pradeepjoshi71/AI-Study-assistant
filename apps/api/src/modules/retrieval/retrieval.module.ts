import { Module } from '@nestjs/common';
import { RetrievalService } from './retrieval.service';
import { QdrantClient } from './qdrant.client';
import { MultiDocRetrievalService } from './multi-doc.retrieval';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [QdrantClient, RetrievalService, MultiDocRetrievalService],
  exports: [RetrievalService, MultiDocRetrievalService, QdrantClient],
})
export class RetrievalModule {}
