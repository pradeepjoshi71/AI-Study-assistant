import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { WebhookDeliveryProcessor } from './processors/webhook-delivery.processor';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({ name: 'webhook-delivery' }),
    BullModule.registerQueue({ name: 'email' }),
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDeliveryProcessor],
  exports: [WebhooksService],
})
export class WebhooksModule {}

