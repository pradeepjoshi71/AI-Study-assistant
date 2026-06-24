import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { StripeService } from './stripe.service';
import { PlansService } from './plans.service';
import { WebhookHandler } from './webhook.handler';
import { PrismaModule } from '../prisma/prisma.module';
import { UsageModule } from '../usage/usage.module';

@Module({
  imports: [PrismaModule, UsageModule],
  controllers: [BillingController],
  providers: [BillingService, StripeService, PlansService, WebhookHandler],
  exports: [BillingService, StripeService, PlansService],
})
export class BillingModule {}
