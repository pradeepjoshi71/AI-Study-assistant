import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import * as dns from 'dns';
import { URL } from 'url';
import { WebhookStatus, WebhookDeliveryStatus } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const isPrivateIp = require('is-private-ip');

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('webhook-delivery') private readonly deliveryQueue: Queue,
  ) {}

  // ─── Endpoint Registration & Validation ─────────────────────────────────

  async createEndpoint(
    orgId: string,
    urlStr: string,
    events: string[],
  ) {
    // 1. Validate URL is not a private IP
    const isValid = await this.validateUrl(urlStr);
    if (!isValid) {
      throw new BadRequestException(
        'Invalid Webhook URL. Hostname cannot resolve to a private or loopback IP address.',
      );
    }

    // Generate automatic HMAC secret
    const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

    const endpoint = await this.prisma.webhookEndpoint.create({
      data: {
        orgId,
        url: urlStr,
        secret,
        events,
        status: WebhookStatus.ACTIVE,
        failureCount: 0,
      },
    });

    return {
      id: endpoint.id,
      url: endpoint.url,
      secret: endpoint.secret, // returned once upon creation
      events: endpoint.events,
      status: endpoint.status,
      createdAt: endpoint.createdAt,
    };
  }

  // ─── Webhook Dispatching ────────────────────────────────────────────────

  /**
   * Find active WebhookEndpoints for orgId where events contains event,
   * then queue BullMQ delivery jobs.
   */
  async dispatch(
    orgId: string,
    event: string,
    payload: Record<string, any>,
  ): Promise<number> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: {
        orgId,
        status: WebhookStatus.ACTIVE,
        events: {
          has: event,
        },
      },
    });

    if (endpoints.length === 0) {
      return 0;
    }

    const payloadWithMetadata = {
      event,
      timestamp: Math.floor(Date.now() / 1000),
      orgId,
      data: payload,
    };

    for (const endpoint of endpoints) {
      try {
        // Create WebhookDelivery record PENDING
        const delivery = await this.prisma.webhookDelivery.create({
          data: {
            endpointId: endpoint.id,
            event,
            payload: payloadWithMetadata as any,
            attempts: 0,
            status: WebhookDeliveryStatus.PENDING,
          },
        });

        // Enqueue background BullMQ job
        await this.deliveryQueue.add(
          'deliver',
          {
            deliveryId: delivery.id,
            endpointId: endpoint.id,
            url: endpoint.url,
            secret: endpoint.secret,
            event,
            payload: payloadWithMetadata,
            attempts: 1, // first attempt
          },
          {
            removeOnComplete: true,
            removeOnFail: 50,
            attempts: 1, // we handle retries customly inside the processor
          },
        );
      } catch (err: any) {
        this.logger.error(
          `Failed to dispatch webhook job for endpoint ${endpoint.id}: ${err.message}`,
        );
      }
    }

    return endpoints.length;
  }

  // ─── Helper: Private IP URL Validation ──────────────────────────────────

  private async validateUrl(urlStr: string): Promise<boolean> {
    try {
      const parsed = new URL(urlStr);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }
      const hostname = parsed.hostname;

      // Resolve DNS to IP addresses
      const ips = await new Promise<string[]>((resolve) => {
        dns.resolve(hostname, (err, addresses) => {
          if (err) {
            // Fallback to dns.lookup for localhost or system hosts file
            dns.lookup(hostname, (lookupErr, address) => {
              if (lookupErr) resolve([]);
              else resolve([address]);
            });
          } else {
            resolve(addresses);
          }
        });
      });

      if (ips.length === 0) {
        return false;
      }

      for (const ip of ips) {
        if (isPrivateIp(ip)) {
          this.logger.warn(`Rejected private IP address: ${ip} for hostname: ${hostname}`);
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  async listEndpoints(orgId: string) {
    return this.prisma.webhookEndpoint.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteEndpoint(id: string, orgId: string) {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id, orgId },
    });
    if (!endpoint) {
      throw new BadRequestException('Webhook endpoint not found or access denied.');
    }
    // Delete WebhookDelivery records first since it has reference
    await this.prisma.webhookDelivery.deleteMany({
      where: { endpointId: id },
    });
    return this.prisma.webhookEndpoint.delete({
      where: { id },
    });
  }
}
