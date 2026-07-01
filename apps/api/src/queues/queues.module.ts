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
import { RetrievalModule } from '../retrieval/retrieval.module';
import { PromptEngineModule } from '../prompt-engine/prompt-engine.module';
import { CitationsModule } from '../citations/citations.module';
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
import { ExamGenerationProcessor } from '../exam/exam-generation.processor';
import { WeaknessDetectionProcessor } from '../exam/weakness-detection.processor';
import { ExamMasteryUpdateProcessor } from '../exam/exam-mastery-update.processor';
import { GroupDocumentSyncProcessor } from './group-document-sync.processor';
import { GroupSessionSummaryProcessor } from './group-session-summary.processor';
import { AnalyticsProcessor } from '../common/processors/analytics.processor';

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
  'exam-generation',
  'weakness-detection',
  'group-document-sync',
  'group-session-summary',
  'admin-user-export',
  'stripe-sync',
  'compliance',
  'email',
  'api-key-usage',
  'webhook-delivery',
  'referral-reward',
  'listing-moderation',
  'analytics',
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
    RetrievalModule,
    PromptEngineModule,
    CitationsModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        connection: {
          sentinels: [
            {
              host: configService.get<string>('REDIS_SENTINEL_HOST', 'localhost'),
              port: Number(configService.get<number>('REDIS_SENTINEL_PORT', 26379)),
            },
          ],
          name: 'mymaster',
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
    ExamGenerationProcessor,
    WeaknessDetectionProcessor,
    ExamMasteryUpdateProcessor,
    GroupDocumentSyncProcessor,
    GroupSessionSummaryProcessor,
    AnalyticsProcessor,
  ],
  exports: [BullModule],
})
export class QueuesModule {}

