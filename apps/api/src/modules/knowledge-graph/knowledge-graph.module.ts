import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { KnowledgeGraphService } from './knowledge-graph.service';
import { KnowledgeGraphController } from './knowledge-graph.controller';

@Module({
  imports: [PrismaModule, RedisModule, ConfigModule],
  controllers: [KnowledgeGraphController],
  providers: [KnowledgeGraphService],
  // Export so ContextBuilderModule can inject KnowledgeGraphService
  exports: [KnowledgeGraphService],
})
export class KnowledgeGraphModule {}

