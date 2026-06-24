import { Module } from '@nestjs/common';
import { QuotaGuard } from './quota.guard';
import { QuotaService } from './quota.service';
import { UsageModule } from '../usage/usage.module';
import { BillingModule } from '../billing/billing.module';
import { RedisModule } from '../redis/redis.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [UsageModule, BillingModule, RedisModule, PrismaModule],
  providers: [QuotaGuard, QuotaService],
  exports: [QuotaGuard, QuotaService],
})
export class QuotaGuardModule {}
