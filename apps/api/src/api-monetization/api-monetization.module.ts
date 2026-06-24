import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyAuthMiddleware } from './api-key-auth.middleware';
import { ApiGatewayController } from './api-gateway.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { UsageModule } from '../usage/usage.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { QuotaGuardModule } from '../quota-guard/quota-guard.module';

@Module({
  imports: [PrismaModule, UsageModule, RetrievalModule, QuotaGuardModule],
  controllers: [ApiKeysController, ApiGatewayController],
  providers: [ApiKeysService, ApiKeyAuthMiddleware],
  exports: [ApiKeysService, ApiKeyAuthMiddleware],
})
export class ApiMonetizationModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ApiKeyAuthMiddleware)
      .forRoutes('api/v1/external/*');
  }
}
