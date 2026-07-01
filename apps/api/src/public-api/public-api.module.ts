import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { CommonModule } from '../common/common.module';
import { DocumentsModule } from '../documents/documents.module';
import { ChatModule } from '../chat/chat.module';
import { QuizModule } from '../modules/quiz/quiz.module';
import { AnalyticsModule } from '../modules/analytics/analytics.module';
import { ApiKeyModule } from '../api-key/api-key.module';
import { ConversationModule } from '../conversation/conversation.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PublicDocumentsController } from './controllers/public-documents.controller';
import { PublicChatController } from './controllers/public-chat.controller';
import { PublicQuizController } from './controllers/public-quiz.controller';
import { PublicProgressController } from './controllers/public-progress.controller';
import { PublicWebhooksController } from './controllers/public-webhooks.controller';
import { PublicOpenApiController } from './controllers/public-openapi.controller';
import { PublicUsageController } from './controllers/public-usage.controller';
import { ApiKeyOrJwtAuthGuard } from './guards/api-key-or-jwt.guard';
import { APIRateLimitInterceptor } from './interceptors/api-rate-limit.interceptor';

/**
 * PublicAPIModule
 *
 * Mounts all /api/public/v1/* routes. Every controller:
 *   - Uses ApiKeyGuard (scope-checked per endpoint via @Scopes())
 *   - Wraps responses in the standard {success, data, meta, error} envelope
 *   - Delegates 100% of business logic to existing internal service modules
 *
 * No new Prisma queries or business logic live here — this is a pure routing
 * and auth translation layer over the existing service layer.
 */
@Module({
  imports: [
    ApiKeyModule,       // ApiKeyGuard + ApiKeyCacheService
    DocumentsModule,    // DocumentsService
    ChatModule,         // ChatService
    ConversationModule, // ConversationService
    QuizModule,         // QuizService
    AnalyticsModule,    // AnalyticsService
    WebhooksModule,     // WebhooksService
    CommonModule,       // CacheService
    PrismaModule,       // PrismaService
    BullModule.registerQueue({ name: 'api-key-usage' }),
    JwtModule.register({}),
    ConfigModule,
  ],
  controllers: [
    PublicDocumentsController,
    PublicChatController,
    PublicQuizController,
    PublicProgressController,
    PublicWebhooksController,
    PublicOpenApiController,
    PublicUsageController,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: APIRateLimitInterceptor,
    },
    ApiKeyOrJwtAuthGuard,
  ],
  exports: [
    ApiKeyOrJwtAuthGuard,
  ],
})
export class PublicApiModule {}


