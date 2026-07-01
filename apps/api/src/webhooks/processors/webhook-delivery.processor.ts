import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhookDeliveryStatus, WebhookStatus } from '@prisma/client';

export interface WebhookDeliveryJobData {
  deliveryId: string;
  endpointId: string;
  url: string;
  secret: string;
  event: string;
  payload: Record<string, any>;
  attempts: number;
}

@Injectable()
@Processor('webhook-delivery', { concurrency: 5 })
export class WebhookDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('webhook-delivery') private readonly deliveryQueue: Queue,
    @InjectQueue('email') private readonly emailQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<WebhookDeliveryJobData>): Promise<void> {
    const { deliveryId, endpointId, url, secret, event, payload, attempts } = job.data;

    this.logger.log(
      `Processing webhook delivery job=${job.id} delivery=${deliveryId} endpoint=${endpointId} URL=${url} attempt=${attempts}`,
    );

    const payloadString = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', secret)
      .update(payloadString)
      .digest('hex');

    const headers = {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': `sha256=${signature}`,
    };

    let statusCode: number | null = null;
    let success = false;
    let errorMessage: string | null = null;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: payloadString,
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      statusCode = response.status;
      success = response.ok; // 2xx status code
      if (!success) {
        errorMessage = `HTTP Status Error: ${response.status} ${response.statusText}`;
      }
    } catch (err: any) {
      success = false;
      errorMessage = err.message || 'Network/Timeout Error';
    }

    const lastAttemptAt = new Date();

    if (success) {
      // ─── Update WebhookDelivery to SUCCESS ─────────────────────────────────
      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: WebhookDeliveryStatus.SUCCESS,
          statusCode,
          attempts,
          lastAttemptAt,
        },
      });

      // Reset endpoint failureCount if delivery is successful
      await this.prisma.webhookEndpoint.update({
        where: { id: endpointId },
        data: { failureCount: 0 },
      });

      this.logger.log(`Webhook delivery ${deliveryId} succeeded on attempt ${attempts}`);
    } else {
      this.logger.warn(
        `Webhook delivery ${deliveryId} failed on attempt ${attempts}: ${errorMessage}`,
      );

      // Update delivery log in DB
      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          statusCode,
          attempts,
          lastAttemptAt,
        },
      });

      if (attempts < 3) {
        // Schedule retry (delay: 1st retry = 1min, 2nd retry = 5min)
        const delayMs = attempts === 1 ? 60000 : 300000;
        await this.deliveryQueue.add(
          'deliver',
          {
            deliveryId,
            endpointId,
            url,
            secret,
            event,
            payload,
            attempts: attempts + 1,
          },
          { delay: delayMs },
        );
        this.logger.log(
          `Scheduled webhook retry ${attempts + 1} for delivery ${deliveryId} in ${delayMs / 1000}s`,
        );
      } else {
        // ─── Mark as FAILED after 3 attempts ──────────────────────────────────
        await this.prisma.webhookDelivery.update({
          where: { id: deliveryId },
          data: {
            status: WebhookDeliveryStatus.FAILED,
          },
        });

        // Increment WebhookEndpoint failure count
        const endpoint = await this.prisma.webhookEndpoint.update({
          where: { id: endpointId },
          data: {
            failureCount: { increment: 1 },
          },
        });

        this.logger.error(
          `Webhook delivery ${deliveryId} permanently FAILED. Endpoint ${endpointId} failureCount is now ${endpoint.failureCount}`,
        );

        if (endpoint.failureCount >= 3) {
          // Disable WebhookEndpoint
          await this.prisma.webhookEndpoint.update({
            where: { id: endpointId },
            data: { status: WebhookStatus.FAILED },
          });

          this.logger.error(
            `Webhook endpoint ${endpointId} automatically disabled (status=FAILED) due to ${endpoint.failureCount} consecutive failures.`,
          );

          // Dispatch email notification to organization owner
          await this.notifyOrgOwnerOfFailure(endpoint.orgId, url);
        }
      }
    }
  }

  private async notifyOrgOwnerOfFailure(orgId: string, endpointUrl: string) {
    try {
      // Find Owner
      let ownerMember = await this.prisma.orgMember.findFirst({
        where: { orgId, role: 'OWNER' },
        include: { user: { select: { email: true } } },
      });

      // Fallback to Admin
      if (!ownerMember?.user?.email) {
        const adminMember = await this.prisma.orgMember.findFirst({
          where: { orgId, role: 'ADMIN' },
          include: { user: { select: { email: true } } },
        });
        if (adminMember) ownerMember = adminMember;
      }

      let ownerEmail = ownerMember?.user?.email;

      // Fallback to Org billing email
      if (!ownerEmail) {
        const org = await this.prisma.organization.findUnique({
          where: { id: orgId },
          select: { billingEmail: true },
        });
        ownerEmail = org?.billingEmail ?? 'admin@study-assistant.com';
      }

      await this.emailQueue.add('send-email', {
        to: ownerEmail,
        subject: 'ALERT: Webhook Endpoint Disabled due to Failures',
        body: `Hello,

Your outbound webhook endpoint (${endpointUrl}) has been automatically disabled because it failed to deliver events 3 consecutive times.

To resume receiving webhooks, please verify your endpoint server is online, and update its status back to ACTIVE in your Developer settings.

Best,
Study Assistant Compliance Team`,
      });

      this.logger.log(`Dispatched webhook disabled notification email to ${ownerEmail}`);
    } catch (err: any) {
      this.logger.warn(`Failed to notify org owner of webhook failure: ${err.message}`);
    }
  }
}
