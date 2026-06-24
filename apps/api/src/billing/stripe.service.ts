import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Stripe from 'stripe';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StripeService implements OnModuleInit {
  private readonly logger = new Logger(StripeService.name);
  private stripe!: Stripe;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY', '');
    if (!secretKey) {
      this.logger.warn('STRIPE_SECRET_KEY not set — billing features will be unavailable');
    }
    this.stripe = new Stripe(secretKey, {
      apiVersion: '2024-06-20' as any,
      typescript: true,
    });
  }

  get client(): Stripe {
    return this.stripe;
  }

  // ─── Customer Management ───────────────────────────────────

  async createCustomer(params: {
    email: string;
    name: string;
    organizationId: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Customer> {
    return this.stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: {
        organizationId: params.organizationId,
        ...params.metadata,
      },
    });
  }

  async updateCustomer(
    stripeCustomerId: string,
    params: Stripe.CustomerUpdateParams,
  ): Promise<Stripe.Customer> {
    return this.stripe.customers.update(stripeCustomerId, params);
  }

  // ─── Subscription Management ──────────────────────────────

  async createSubscription(params: {
    stripeCustomerId: string;
    stripePriceId: string;
    trialDays?: number;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.create({
      customer: params.stripeCustomerId,
      items: [{ price: params.stripePriceId }],
      trial_period_days: params.trialDays,
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
      metadata: params.metadata ?? {},
    });
  }

  async updateSubscription(
    stripeSubscriptionId: string,
    params: Stripe.SubscriptionUpdateParams,
  ): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.update(stripeSubscriptionId, params);
  }

  async cancelSubscription(
    stripeSubscriptionId: string,
    atPeriodEnd = true,
  ): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: atPeriodEnd,
    });
  }

  async changeSubscriptionPlan(
    stripeSubscriptionId: string,
    currentItemId: string,
    newPriceId: string,
  ): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.update(stripeSubscriptionId, {
      items: [{ id: currentItemId, price: newPriceId }],
      proration_behavior: 'create_prorations',
    });
  }

  // ─── Payment Methods ──────────────────────────────────────

  async createSetupIntent(stripeCustomerId: string): Promise<Stripe.SetupIntent> {
    return this.stripe.setupIntents.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
    });
  }

  async listPaymentMethods(stripeCustomerId: string): Promise<Stripe.PaymentMethod[]> {
    const result = await this.stripe.customers.listPaymentMethods(stripeCustomerId, {
      type: 'card',
    });
    return result.data;
  }

  // ─── Portal & Checkout ────────────────────────────────────

  async createCustomerPortalSession(params: {
    stripeCustomerId: string;
    returnUrl: string;
  }): Promise<Stripe.BillingPortal.Session> {
    return this.stripe.billingPortal.sessions.create({
      customer: params.stripeCustomerId,
      return_url: params.returnUrl,
    });
  }

  async createCheckoutSession(params: {
    stripeCustomerId: string;
    stripePriceId: string;
    successUrl: string;
    cancelUrl: string;
    trialDays?: number;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Checkout.Session> {
    return this.stripe.checkout.sessions.create({
      customer: params.stripeCustomerId,
      mode: 'subscription',
      line_items: [{ price: params.stripePriceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: params.trialDays,
        metadata: params.metadata ?? {},
      },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      allow_promotion_codes: true,
    });
  }

  // ─── Invoices ─────────────────────────────────────────────

  async listInvoices(
    stripeCustomerId: string,
    limit = 10,
  ): Promise<Stripe.Invoice[]> {
    const result = await this.stripe.invoices.list({
      customer: stripeCustomerId,
      limit,
    });
    return result.data;
  }

  // ─── Webhook Verification ─────────────────────────────────

  constructWebhookEvent(payload: Buffer, signature: string): Stripe.Event {
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET', '');
    return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }
}
