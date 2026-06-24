import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyticsModule } from '../analytics/analytics.module';
import { InsightsService } from './insights.service';
import { InsightsController } from './insights.controller';

@Module({
  imports: [AnalyticsModule, ConfigModule],
  providers: [InsightsService],
  controllers: [InsightsController],
  exports: [InsightsService],
})
export class InsightsModule {}
