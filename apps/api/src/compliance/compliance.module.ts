import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ComplianceController } from './compliance.controller';
import { ComplianceProcessor } from './processors/compliance.processor';
import { EmailProcessor } from './processors/email.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { RetrievalModule } from '../modules/retrieval/retrieval.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    BillingModule,
    RetrievalModule,
    RedisModule,
    BullModule.registerQueue(
      { name: 'compliance' },
      { name: 'email' },
    ),
  ],
  controllers: [ComplianceController],
  providers: [ComplianceProcessor, EmailProcessor],
  exports: [BullModule],
})
export class ComplianceModule {}
