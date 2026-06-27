import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe.service';
import Stripe from 'stripe';
import { SubscriptionStatus, InvoiceStatus } from '@prisma/client';

/**
 * Stripe webhook event processor.
 *
 * Critical design rule: every handler must be IDEMPOTENT.
 * We use the StripeEvent table as an idempotency log.
 */
@Injectable()
export class WebhookHandler {
  private readonly logger = new Logger(WebhookHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  async handle(event: Stripe.Event): Promise<void> {
    // ── Idempotency check ───────────────────────────────────
    const existing = await this.prisma.stripeEvent.findUnique({
      where: { id: event.id },
    });
    if (existing) {
      this.logger.debug(`Stripe event ${event.id} already processed — skipping`);
      return;
    }

    // ── Record event first (before processing) ──────────────
    await this.prisma.stripeEvent.create({
      data: { id: event.id, type: event.type, payload: event as any },
    });

    // ── Route to appropriate handler ────────────────────────
    try {
      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;

        case 'invoice.payment_succeeded':
          await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
          break;

        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          break;

        case 'customer.subscription.trial_will_end':
          await this.handleTrialWillEnd(event.data.object as Stripe.Subscription);
          break;

        default:
          this.logger.debug(`Unhandled Stripe event type: ${event.type}`);
      }
    } catch (err: any) {
      this.logger.error(`Failed to process Stripe event ${event.id}: ${err.message}`);
      throw err; // Re-throw so Stripe retries
    }
  }

  private async handleSubscriptionUpdated(sub: Stripe.Subscription) {
    const organizationId = sub.metadata?.organizationId;
    if (!organizationId) {
      this.logger.warn(`Subscription ${sub.id} has no organizationId metadata`);
      return;
    }

    const statusMap: Record<string, SubscriptionStatus> = {
      active: SubscriptionStatus.ACTIVE,
      trialing: SubscriptionStatus.TRIALING,
      past_due: SubscriptionStatus.PAST_DUE,
      canceled: SubscriptionStatus.CANCELED,
      paused: SubscriptionStatus.PAUSED,
      incomplete: SubscriptionStatus.INCOMPLETE,
    };

    await this.prisma.subscription.updateMany({
      where: { organizationId },
      data: {
        status: statusMap[sub.status] ?? SubscriptionStatus.ACTIVE,
        stripeSubscriptionId: sub.id,
        stripeItemId: sub.items.data[0]?.id,
        currentPeriodStart: new Date((sub as any).current_period_start * 1000),
        currentPeriodEnd: new Date((sub as any).current_period_end * 1000),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        trialEndAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      },
    });
    this.logger.log(`Subscription updated for org ${organizationId}: ${sub.status}`);
  }

  private async handleSubscriptionDeleted(sub: Stripe.Subscription) {
    const organizationId = sub.metadata?.organizationId;
    if (!organizationId) return;

    await this.prisma.subscription.updateMany({
      where: { organizationId },
      data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date() },
    });
    this.logger.log(`Subscription canceled for org ${organizationId}`);
  }

  private async handleInvoicePaid(invoice: Stripe.Invoice) {
    const customerId = invoice.customer as string;
    const org = await this.prisma.organization.findFirst({
      where: { stripeCustomerId: customerId },
    });
    if (!org) return;

    await this.prisma.invoice.upsert({
      where: { stripeInvoiceId: invoice.id },
      create: {
        organizationId: org.id,
        stripeInvoiceId: invoice.id,
        status: InvoiceStatus.PAID,
        amountDueUsdCents: invoice.amount_due,
        amountPaidUsdCents: invoice.amount_paid,
        currency: invoice.currency,
        invoicePdfUrl: invoice.invoice_pdf,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
        paidAt: new Date(),
        periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
        periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
      },
      update: {
        status: InvoiceStatus.PAID,
        amountPaidUsdCents: invoice.amount_paid,
        paidAt: new Date(),
      },
    });

    // Reset period usage counters on successful payment
    await this.prisma.subscription.updateMany({
      where: { organizationId: org.id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodChatsUsed: 0,
        currentPeriodTokensUsed: 0,
        currentPeriodApiCallsUsed: 0,
      },
    });

    this.logger.log(`Invoice paid for org ${org.id}: $${invoice.amount_paid / 100}`);
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    const customerId = invoice.customer as string;
    const org = await this.prisma.organization.findFirst({
      where: { stripeCustomerId: customerId },
    });
    if (!org) return;

    await this.prisma.invoice.upsert({
      where: { stripeInvoiceId: invoice.id },
      create: {
        organizationId: org.id,
        stripeInvoiceId: invoice.id,
        status: InvoiceStatus.OPEN,
        amountDueUsdCents: invoice.amount_due,
        amountPaidUsdCents: 0,
        currency: invoice.currency,
      },
      update: { status: InvoiceStatus.OPEN },
    });

    await this.prisma.subscription.updateMany({
      where: { organizationId: org.id },
      data: { status: SubscriptionStatus.PAST_DUE },
    });

    this.logger.warn(`Invoice payment FAILED for org ${org.id}`);
  }

  private async handleTrialWillEnd(sub: Stripe.Subscription) {
    const organizationId = sub.metadata?.organizationId;
    this.logger.log(`Trial ending soon for org ${organizationId}`);
    // TODO: trigger email notification via EventEmitter
  }
}
