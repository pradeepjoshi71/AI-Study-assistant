import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { TutorService } from './tutor.service';
import { TutorController } from './tutor.controller';

@Module({
  imports: [PrismaModule, AnalyticsModule, ConfigModule],
  providers: [TutorService],
  controllers: [TutorController],
  exports: [TutorService],
})
export class TutorModule {}
