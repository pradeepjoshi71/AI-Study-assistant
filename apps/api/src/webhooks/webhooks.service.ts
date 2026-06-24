import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

export interface WebhookEventPayload {
  event: string;
  timestamp: number;
  organizationId: string;
  data: Record<string, any>;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Dispatch an outbound webhook event to the organization's registered endpoint.
   */
  async sendWebhook(organizationId: string, event: string, data: Record<string, any>): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { webhookUrl: true, webhookSecret: true },
    });

    if (!org || !org.webhookUrl) {
      // No webhook configured, skip silently
      return false;
    }

    const payload: WebhookEventPayload = {
      event,
      timestamp: Math.floor(Date.now() / 1000),
      organizationId,
      data,
    };

    const payloadString = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-StudyAssistant-Timestamp': payload.timestamp.toString(),
    };

    // Calculate signature if secret is provided
    if (org.webhookSecret) {
      const signature = crypto
        .createHmac('sha256', org.webhookSecret)
        .update(`${payload.timestamp}.${payloadString}`)
        .digest('hex');
      headers['X-StudyAssistant-Signature'] = signature;
    }

    this.logger.log(`Dispatching outbound webhook [${event}] to ${org.webhookUrl} for organization ${organizationId}`);

    // Fire-and-forget async execution with retries
    this.executeRequestWithRetry(org.webhookUrl, headers, payloadString);

    return true;
  }

  private async executeRequestWithRetry(
    url: string,
    headers: Record<string, string>,
    body: string,
    attempt = 1,
    maxAttempts = 3,
  ): Promise<void> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(5000), // 5s timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP Error Status ${response.status}`);
      }

      this.logger.log(`Outbound webhook delivered successfully to ${url}`);
    } catch (err: any) {
      this.logger.warn(`Failed outbound webhook delivery attempt ${attempt}/${maxAttempts} to ${url}: ${err.message}`);

      if (attempt < maxAttempts) {
        const backoffDelay = Math.pow(2, attempt) * 2000; // 4s, 8s
        setTimeout(() => {
          this.executeRequestWithRetry(url, headers, body, attempt + 1, maxAttempts);
        }, backoffDelay);
      } else {
        this.logger.error(`Exceeded maximum retry attempts for webhook delivery to ${url}`);
      }
    }
  }
}
