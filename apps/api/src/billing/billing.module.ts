import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { StripeService } from './stripe.service';
import { PlansService } from './plans.service';
import { WebhookHandler } from './webhook.handler';
import { PrismaModule } from '../prisma/prisma.module';
import { UsageModule } from '../usage/usage.module';

@Module({
  imports: [
    PrismaModule,
    UsageModule,
    BullModule.registerQueue(
      { name: 'billing-notifications' },
      { name: 'referral-reward' },
    ),
  ],
  controllers: [BillingController],
  providers: [BillingService, StripeService, PlansService, WebhookHandler],
  exports: [BillingService, StripeService, PlansService],
})
export class BillingModule {}
