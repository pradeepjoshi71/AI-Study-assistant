import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';
import { KnowledgeGraphModule } from '../modules/knowledge-graph/knowledge-graph.module';
import { MemoryModule } from '../modules/memory/memory.module';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { ChatModule } from '../chat/chat.module';
import { FlashcardModule } from '../modules/flashcards/flashcards.module';
import { QuizModule } from '../modules/quiz/quiz.module';
import { GraphBuildingProcessor } from './graph-building.processor';
import { AnalyticsAggregationProcessor } from './analytics-aggregation.processor';
import { MemorySummarizationProcessor } from './memory-summarization.processor';
import { CostAggregationProcessor } from './cost-aggregation.processor';
import { PushNotificationProcessor } from './push-notification.processor';
import { PushService } from '../platform/push.service';
import { VoiceCleanupProcessor } from './voice-cleanup.processor';
import { VoiceProcessingProcessor } from './voice-processing.processor';
import { AdaptiveMasteryProcessor } from './adaptive-mastery.processor';
import { AdaptiveContentProcessor } from './adaptive-content.processor';

const QUEUE_NAMES = [
  'document-processing',
  'embedding-generation',
  'graph-building',
  'analytics-aggregation',
  'memory-summarization',
  'cost-aggregation',
  'org-notifications',
  'badge-check',
  'push-notifications',
  'voice-cleanup',
  'voice-processing',
  'adaptive-mastery',
];

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    KnowledgeGraphModule,
    MemoryModule,
    ConfigModule,
    AuthModule,
    StorageModule,
    ChatModule,
    FlashcardModule,
    QuizModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: Number(configService.get<number>('REDIS_PORT', 6379)),
          password: configService.get<string>('REDIS_PASSWORD', '') || undefined,
          skipVersionCheck: true,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 3000 },
          removeOnComplete: 100, // keep last 100 completed jobs
          removeOnFail: 50,
        },
      }),
      inject: [ConfigService],
    }),
    ...QUEUE_NAMES.map((name) => BullModule.registerQueue({ name })),
  ],
  providers: [
    GraphBuildingProcessor,
    AnalyticsAggregationProcessor,
    MemorySummarizationProcessor,
    CostAggregationProcessor,
    PushNotificationProcessor,
    PushService,
    VoiceCleanupProcessor,
    VoiceProcessingProcessor,
    AdaptiveMasteryProcessor,
    AdaptiveContentProcessor,
  ],
  exports: [BullModule],
})
export class QueuesModule {}

