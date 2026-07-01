import { Module, Get, Controller, MiddlewareConsumer, NestModule, ServiceUnavailableException } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ScheduleModule } from "@nestjs/schedule";
import { RedisThrottlerStorage } from "./common/throttler/redis-throttler-storage";
import { TieredThrottlerGuard } from "./common/throttler/tiered-throttler.guard";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { PrismaService } from "./prisma/prisma.service";
import { RedisService } from "./redis/redis.service";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { StorageModule } from "./storage/storage.module";
import { QueuesModule } from "./queues/queues.module";
import { DocumentsModule } from "./documents/documents.module";
import { ChatModule } from "./chat/chat.module";
import { ConversationModule } from "./modules/conversation/conversation.module";
import { MessagesModule } from "./modules/messages/message.module";
import { RetrievalModule } from "./modules/retrieval/retrieval.module";
import { ContextBuilderModule } from "./modules/context-builder/context-builder.module";
import { PromptEngineModule } from "./modules/prompt-engine/prompt-engine.module";
import { CitationsModule } from "./modules/citations/citations.module";
import { StreamingModule } from "./modules/streaming/streaming.module";
import { MemoryModule } from "./modules/memory/memory.module";
import { SynthesisModule } from "./modules/synthesis/synthesis.module";
import { QuizModule } from "./modules/quiz/quiz.module";
import { FlashcardModule } from "./modules/flashcards/flashcards.module";
import { StudyModeModule } from "./modules/study-mode/study-mode.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { InsightsModule } from "./modules/insights/insights.module";
import { TutorModule } from "./modules/tutor-agent/tutor.module";
import { KnowledgeGraphModule } from "./modules/knowledge-graph/knowledge-graph.module";
import { CommonModule } from "./common/common.module";
import { CorrelationIdMiddleware } from "./common/middleware/correlation-id.middleware";
import { UserContextMiddleware } from "./common/middleware/user-context.middleware";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";
import { PlanGuard } from "./common/guards/plan.guard";
import { TenantMiddleware } from "./common/middleware/tenant.middleware";
import { TenantInterceptor } from "./common/interceptors/tenant.interceptor";
import { TenantFeatureGuard } from "./common/guards/tenant-feature.guard";

// Phase 3.0 SaaS Modules
import { BillingModule } from "./billing/billing.module";
import { OrganizationModule } from "./organization/organization.module";
import { ResellerModule } from "./reseller/reseller.module";
import { UsageModule } from "./usage/usage.module";
import { QuotaGuardModule } from "./quota-guard/quota-guard.module";
import { TeamsModule } from "./teams/teams.module";
import { ApiMonetizationModule } from "./api-monetization/api-monetization.module";
import { AdminModule } from "./admin/admin.module";
import { PricingModule } from "./pricing/pricing.module";
import { FeatureFlagsModule } from "./feature-flags/feature-flags.module";
import { WebhooksModule } from "./webhooks/webhooks.module";
import { ReferralModule } from "./referral/referral.module";

// Phase 3.1 Enterprise Security Modules
import { SsoModule } from "./sso/sso.module";
import { AuditModule } from "./audit/audit.module";
import { RetentionModule } from "./retention/retention.module";
import { ComplianceModule } from "./compliance/compliance.module";
import { SecurityGuardModule } from "./security-guard/security-guard.module";

// Phase 3.2 AI Agent Marketplace Modules
import { PluginRuntimeModule } from "./plugin-runtime/plugin-runtime.module";
import { PluginsModule } from "./plugins/plugins.module";
import { MarketplaceModule } from "./marketplace/marketplace.module";

// Phase 3.3 Autonomous AI Ecosystem Modules
import { PromptOptimizerModule } from "./prompt-optimizer/prompt-optimizer.module";
import { ToolGeneratorModule } from "./tool-generator/tool-generator.module";
import { LearningLoopModule } from "./learning-loop/learning-loop.module";
import { AutonomousAgentModule } from "./autonomous-agent/autonomous-agent.module";

// Phase 3.4 AI Operating System Layer
import { AiOsModule } from "./ai-os/ai-os.module";

// Phase 4.0 Global Ecosystem Metrics
import { MetricsModule } from "./platform/metrics/metrics.module";
import { GamificationModule } from "./gamification/gamification.module";

// Phase 5.0 Exam Engine
import { ExamModule } from "./exam/exam.module";
import { StudyGroupModule } from "./study-group/study-group.module";
import { ApiKeyModule } from "./api-key/api-key.module";
import { PublicApiModule } from "./public-api/public-api.module";

@Controller("health")
export class HealthController {
  private readonly aiServiceUrl: string;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private config: ConfigService,
  ) {
    this.aiServiceUrl = this.config.get<string>('NEXT_PUBLIC_AI_SERVICE_URL', 'http://localhost:8000');
  }

  @Get()
  async getHealth() {
    // 1. PostgreSQL
    let databaseStatus = "UP";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      databaseStatus = "DOWN";
    }

    // 2. Redis
    let redisStatus = "UP";
    try {
      await this.redis.getClient().ping();
    } catch {
      redisStatus = "DOWN";
    }

    const allUp = databaseStatus === "UP" && redisStatus === "UP";

    const payload = {
      status: allUp ? "ok" : "degraded",
      db: databaseStatus,
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    };

    if (!allUp) {
      throw new ServiceUnavailableException(payload);
    }

    return payload;
  }

}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: (redisService: RedisService) => ({
        storage: new RedisThrottlerStorage(redisService),
        throttlers: [
          {
            name: "free",
            ttl: 60000,
            limit: 10,
          },
          {
            name: "pro",
            ttl: 60000,
            limit: 60,
          },
          {
            name: "premium",
            ttl: 60000,
            limit: 200,
          },
          {
            name: "admin",
            ttl: 60000,
            limit: 30,
          },
        ],
      }),
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    StorageModule,
    QueuesModule,
    DocumentsModule,
    ChatModule,
    ConversationModule,
    MessagesModule,
    RetrievalModule,
    ContextBuilderModule,
    PromptEngineModule,
    CitationsModule,
    StreamingModule,
    MemoryModule,
    SynthesisModule,
    QuizModule,
    FlashcardModule,
    StudyModeModule,
    AnalyticsModule,
    InsightsModule,
    TutorModule,
    KnowledgeGraphModule,
    CommonModule,
    BillingModule,
    OrganizationModule,
    UsageModule,
    QuotaGuardModule,
    TeamsModule,
    ApiMonetizationModule,
    AdminModule,
    PricingModule,
    FeatureFlagsModule,
    WebhooksModule,
    ReferralModule,
    SsoModule,
    AuditModule,
    RetentionModule,
    ComplianceModule,
    SecurityGuardModule,
    PluginRuntimeModule,
    PluginsModule,
    MarketplaceModule,
    ResellerModule,
    PromptOptimizerModule,
    ToolGeneratorModule,
    LearningLoopModule,
    AutonomousAgentModule,
    AiOsModule,
    // Phase 4.0 — Global Ecosystem Metrics
    MetricsModule,
    GamificationModule,
    // Phase 5.0 — Exam Engine
    ExamModule,
    StudyGroupModule,
    ApiKeyModule,
    PublicApiModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: TieredThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PlanGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TenantFeatureGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  /**
   * Register CorrelationIdMiddleware globally across all routes.
   * This runs BEFORE guards and interceptors — ensuring every request
   * gets a correlation ID for distributed tracing.
   */
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware, UserContextMiddleware, TenantMiddleware).forRoutes('*');
  }
}
