import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { PrometheusMetricsController } from './prometheus.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
  ],
  providers: [MetricsService],
  controllers: [MetricsController, PrometheusMetricsController],
  exports: [MetricsService],
})
export class MetricsModule {}
