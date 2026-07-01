import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { ApiKeyService } from './api-key.service';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyCacheService } from './api-key-cache.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ApiKeyUsageProcessor } from './processors/api-key-usage.processor';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    BullModule.registerQueue({ name: 'api-key-usage' }),
  ],
  controllers: [ApiKeyController],
  providers: [
    ApiKeyService,
    ApiKeyCacheService,
    ApiKeyGuard,
    ApiKeyUsageProcessor,
  ],
  exports: [
    ApiKeyService,
    ApiKeyCacheService,
    ApiKeyGuard,
  ],
})
export class ApiKeyModule {}
