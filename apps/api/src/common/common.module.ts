import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { CacheService } from './services/cache.service';
import { MetricsService } from './services/metrics.service';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { RateLimitGuard } from './guards/rate-limit.guard';

/**
 * @Global() — exported providers (CacheService, MetricsService) are available
 * to ANY module that imports CommonModule without needing re-declaration.
 */
@Global()
@Module({
  imports: [PrismaModule, RedisModule],
  providers: [CacheService, MetricsService, LoggingInterceptor, RateLimitGuard],
  exports: [CacheService, MetricsService, LoggingInterceptor, RateLimitGuard],
})
export class CommonModule {}

