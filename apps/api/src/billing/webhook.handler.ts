import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { StripeService } from "./stripe.service";
import { CacheService } from "../common/services/cache.service";
import Stripe from "stripe";
import { SubscriptionStatus, InvoiceStatus, PlanType } from "@prisma/client";
import { EventEmitter2 } from "@nestjs/event-emitter";

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
    private readonly cache: CacheService,
    @InjectQueue("billing-notifications") private readonly billingQueue: Queue,
    @InjectQueue("referral-reward") private readonly referralRewardQueue: Queue,
    private readonly eventEmitter: EventEmitter2,
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
        case "checkout.session.completed":
          await this.handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
          break;

        case "customer.subscription.updated":
          await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;

        case "customer.subscription.deleted":
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;

        case "invoice.payment_succeeded":
          await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
          break;

        case "invoice.payment_failed":
          await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          break;

        default:
          this.logger.debug(`Unhandled Stripe event type: ${event.type}`);
      }
    } catch (err: any) {
      this.logger.error(`Failed to process Stripe event ${event.id}: ${err.message}`);
      throw err; // Re-throw so Stripe retries
    }
  }

  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.userId;
    if (!userId) {
      this.logger.warn(`Checkout session ${session.id} completed with no userId metadata`);
      return;
    }

    const planType = session.metadata?.planType as PlanType;
    const plan = await this.prisma.plan.findUnique({
      where: { type: planType || PlanType.FREE }
    });

    if (!plan) {
      this.logger.error(`Plan not found for type: ${planType}`);
      return;
    }

    // Update user with subscription ID
    await this.prisma.user.update({
      where: { id: userId },
      data: { stripeSubscriptionId: session.subscription as string }
    });

    // Resolve subscription end date
    let currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    if (session.subscription) {
      try {
        const stripeSub = await this.stripe.client.subscriptions.retrieve(session.subscription as string);
        currentPeriodEnd = new Date((stripeSub as any).current_period_end * 1000);
      } catch (err: any) {
        this.logger.warn(`Failed to fetch subscription period end from Stripe: ${err.message}`);
      }
    }

    const existingSub = await this.prisma.subscription.findFirst({
      where: { userId }
    });

    if (existingSub) {
      await this.prisma.subscription.update({
        where: { id: existingSub.id },
        data: {
          planId: plan.id,
          status: SubscriptionStatus.ACTIVE,
          stripeSubscriptionId: session.subscription as string,
          currentPeriodEnd,
        }
      });
    } else {
      await this.prisma.subscription.create({
        data: {
          userId,
          organizationId: session.metadata?.organizationId || "",
          planId: plan.id,
          status: SubscriptionStatus.ACTIVE,
          stripeSubscriptionId: session.subscription as string,
          currentPeriodEnd,
        }
      });
    }

    await this.invalidateUserCache(userId);
    await this.dispatchBullJob(userId, "checkout.session.completed", session);
  }

  private async handleSubscriptionUpdated(sub: Stripe.Subscription) {
    let userId: string | undefined = sub.metadata?.userId;
    if (!userId) {
      const user = await this.prisma.user.findFirst({
        where: {
          OR: [
            { stripeSubscriptionId: sub.id },
            { stripeCustomerId: sub.customer as string }
          ]
        }
      });
      userId = user?.id;
    }
    if (!userId) {
      this.logger.warn(`Subscription updated event: could not resolve userId for subscription ${sub.id}`);
      return;
    }

    const priceId = sub.items.data[0]?.price.id;
    const plan = await this.prisma.plan.findFirst({
      where: {
        OR: [
          { stripePriceId: priceId },
          { stripePriceIdMonthly: priceId },
          { stripePriceIdYearly: priceId }
        ]
      }
    });

    const statusMap: Record<string, SubscriptionStatus> = {
      active: SubscriptionStatus.ACTIVE,
      trialing: SubscriptionStatus.TRIALING,
      past_due: SubscriptionStatus.PAST_DUE,
      canceled: SubscriptionStatus.CANCELED,
      paused: SubscriptionStatus.PAUSED,
      incomplete: SubscriptionStatus.INCOMPLETE,
      unpaid: SubscriptionStatus.PAST_DUE,
    };

    const status = statusMap[sub.status] ?? SubscriptionStatus.ACTIVE;
    const currentPeriodEnd = new Date((sub as any).current_period_end * 1000);
    const trialEndAt = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
    const planId = plan?.id || (await this.getDefaultFreePlanId());

    const existingSub = await this.prisma.subscription.findFirst({
      where: { userId }
    });

    if (existingSub) {
      await this.prisma.subscription.update({
        where: { id: existingSub.id },
        data: {
          planId,
          status,
          stripeSubscriptionId: sub.id,
          currentPeriodEnd,
          trialEndAt,
        }
      });
    } else {
      await this.prisma.subscription.create({
        data: {
          userId,
          organizationId: sub.metadata?.organizationId || "",
          planId,
          status,
          stripeSubscriptionId: sub.id,
          currentPeriodEnd,
          trialEndAt,
        }
      });
    }

    await this.invalidateUserCache(userId);
    await this.dispatchBullJob(userId, "customer.subscription.updated", sub);
  }

  private async handleSubscriptionDeleted(sub: Stripe.Subscription) {
    let userId: string | undefined = sub.metadata?.userId;
    if (!userId) {
      const user = await this.prisma.user.findFirst({
        where: {
          OR: [
            { stripeSubscriptionId: sub.id },
            { stripeCustomerId: sub.customer as string }
          ]
        }
      });
      userId = user?.id;
    }
    if (!userId) return;

    const freePlan = await this.prisma.plan.findUnique({
      where: { type: PlanType.FREE }
    });
    const planId = freePlan?.id || "";

    const existingSub = await this.prisma.subscription.findFirst({
      where: { userId }
    });

    if (existingSub) {
      await this.prisma.subscription.update({
        where: { id: existingSub.id },
        data: {
          planId,
          status: SubscriptionStatus.CANCELED,
          canceledAt: new Date(),
        }
      });
    } else {
      await this.prisma.subscription.create({
        data: {
          userId,
          organizationId: sub.metadata?.organizationId || "",
          planId,
          status: SubscriptionStatus.CANCELED,
          currentPeriodEnd: new Date(),
        }
      });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { stripeSubscriptionId: null }
    });

    await this.invalidateUserCache(userId);
    await this.dispatchBullJob(userId, "customer.subscription.deleted", sub);
  }

  private async handleInvoicePaid(invoice: Stripe.Invoice) {
    let userId: string | undefined = invoice.metadata?.userId;
    const stripeSubscriptionId = (invoice as any).subscription as string;
    if (!userId) {
      const user = await this.prisma.user.findFirst({
        where: {
          OR: [
            { stripeSubscriptionId },
            { stripeCustomerId: invoice.customer as string }
          ]
        }
      });
      userId = user?.id;
    }
    if (!userId) return;

    await this.prisma.invoice.upsert({
      where: { stripeInvoiceId: invoice.id },
      create: {
        userId,
        organizationId: invoice.metadata?.organizationId || "",
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
      }
    });

    await this.prisma.subscription.updateMany({
      where: { userId },
      data: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodChatsUsed: 0,
        currentPeriodTokensUsed: 0,
        currentPeriodApiCallsUsed: 0,
      }
    });

    // Check if the user has an active SIGNED_UP referral (indicating first payment)
    const referral = await this.prisma.referral.findFirst({
      where: {
        refereeId: userId,
        status: "SIGNED_UP",
      },
    });

    if (referral) {
      await this.prisma.referral.update({
        where: { id: referral.id },
        data: {
          status: "CONVERTED",
          convertedAt: new Date(),
        },
      });

      this.eventEmitter.emit("referral.converted", {
        referralId: referral.id,
      });
      this.logger.log(`Referral ${referral.id} converted for referee ${userId}`);
    }

    await this.invalidateUserCache(userId);
    await this.dispatchBullJob(userId, "invoice.paid", invoice);
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    let userId: string | undefined = invoice.metadata?.userId;
    const stripeSubscriptionId = (invoice as any).subscription as string;
    if (!userId) {
      const user = await this.prisma.user.findFirst({
        where: {
          OR: [
            { stripeSubscriptionId },
            { stripeCustomerId: invoice.customer as string }
          ]
        }
      });
      userId = user?.id;
    }
    if (!userId) return;

    await this.prisma.invoice.upsert({
      where: { stripeInvoiceId: invoice.id },
      create: {
        userId,
        organizationId: invoice.metadata?.organizationId || "",
        stripeInvoiceId: invoice.id,
        status: InvoiceStatus.OPEN,
        amountDueUsdCents: invoice.amount_due,
        amountPaidUsdCents: 0,
        currency: invoice.currency,
      },
      update: { status: InvoiceStatus.OPEN }
    });

    await this.prisma.subscription.updateMany({
      where: { userId },
      data: { status: SubscriptionStatus.PAST_DUE }
    });

    await this.invalidateUserCache(userId);
    await this.dispatchBullJob(userId, "invoice.payment_failed", invoice);
  }

  private async getDefaultFreePlanId(): Promise<string> {
    const free = await this.prisma.plan.findUnique({ where: { type: PlanType.FREE } });
    return free?.id || "";
  }

  private async invalidateUserCache(userId: string): Promise<void> {
    await this.cache.del(CacheService.userPlanKey(userId)).catch(() => {});
    await this.cache.del(CacheService.userSessionKey(userId)).catch(() => {});
    this.logger.log(`Invalidated plan and session caches for user: ${userId}`);
  }

  private async dispatchBullJob(userId: string, eventType: string, payload: any): Promise<void> {
    try {
      await this.billingQueue.add("side-effects", {
        userId,
        eventType,
        payload,
      });
      this.logger.log(`Dispatched BullMQ job for event type "${eventType}" and user ${userId}`);
    } catch (err: any) {
      this.logger.error(`Failed to dispatch BullMQ job: ${err.message}`);
    }
  }
}
