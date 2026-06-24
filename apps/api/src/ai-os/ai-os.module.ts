import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { StorageModule } from '../storage/storage.module';
import { RetrievalModule } from '../modules/retrieval/retrieval.module';
import { KnowledgeGraphModule } from '../modules/knowledge-graph/knowledge-graph.module';
import { QueuesModule } from '../queues/queues.module';

import { AgentKernelService } from './kernel/agent-kernel.service';
import { ComputeSchedulerService } from './scheduler/compute-scheduler.service';
import { StorageAbstractionService } from './storage/storage-abstraction.service';
import { CostRouterService } from './router/cost-router.service';
import { PolicyEngineService } from './policy/policy-engine.service';
import { AiOsController } from './ai-os.controller';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    StorageModule,
    RetrievalModule,
    KnowledgeGraphModule,
    QueuesModule,
  ],
  controllers: [AiOsController],
  providers: [
    AgentKernelService,
    ComputeSchedulerService,
    StorageAbstractionService,
    CostRouterService,
    PolicyEngineService,
  ],
  exports: [
    AgentKernelService,
    ComputeSchedulerService,
    StorageAbstractionService,
    CostRouterService,
    PolicyEngineService,
  ],
})
export class AiOsModule {}
