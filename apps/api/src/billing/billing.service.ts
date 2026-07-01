import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe.service';
import { PlansService } from './plans.service';
import Stripe from 'stripe';
import { BillingCycle, PlanType, SubscriptionStatus, ActorType } from '@prisma/client';
import { CreateOrganizationDto } from './dtos/create-organization.dto';
import { UpgradeSubscriptionDto } from './dtos/upgrade-subscription.dto';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly plans: PlansService,
  ) {}

  // ─── Organization ─────────────────────────────────────────

  /**
   * Called when a new user registers — creates a personal organization
   * on the FREE plan automatically.
   */
  async createOrganization(
    dto: CreateOrganizationDto,
    ownerId: string,
  ) {
    // Check slug uniqueness
    const existing = await this.prisma.organization.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) throw new ConflictException('Organization slug already taken');

    const freePlan = await this.plans.findByType(PlanType.FREE);
    if (!freePlan) throw new BadRequestException('FREE plan not seeded');

    // Create Stripe customer (fire-and-forget on error — can retry later)
    let stripeCustomerId: string | null = null;
    try {
      const customer = await this.stripe.createCustomer({
        email: dto.billingEmail ?? '',
        name: dto.name,
        organizationId: '', // will be updated after org creation
      });
      stripeCustomerId = customer.id;
    } catch (err: any) {
      this.logger.warn(`Stripe customer creation failed: ${err.message}`);
    }

    // Create org + subscription + member in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          billingEmail: dto.billingEmail,
          stripeCustomerId,
        },
      });

      // Update Stripe customer metadata now we have org ID
      if (stripeCustomerId) {
        await this.stripe.updateCustomer(stripeCustomerId, {
          metadata: { organizationId: org.id },
        }).catch(() => {});
      }

      // Create FREE subscription (no Stripe sub needed for free)
      await tx.subscription.create({
        data: {
          organizationId: org.id,
          planId: freePlan.id,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days rolling
        },
      });

      // Add owner as OWNER member
      await tx.orgMember.create({
        data: {
          orgId: org.id,
          userId: ownerId,
          role: 'OWNER',
        },
      });

      return org;
    });

    await this.prisma.auditLog.create({
      data: {
        orgId: result.id,
        userId: ownerId,
        actorId: ownerId,
        actorType: ActorType.USER,
        action: 'organization.created',
        resourceType: 'organization',
        resourceId: result.id,
        metadata: {},
      },
    });

    return result;
  }

  // ─── Subscription Upgrade / Downgrade ─────────────────────

  async upgradeSubscription(
    organizationId: string,
    dto: UpgradeSubscriptionDto,
    actorId: string,
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { subscription: { include: { plan: true } } },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (!org.stripeCustomerId) throw new BadRequestException('No Stripe customer — contact support');

    const newPlan = await this.plans.findByType(dto.planType);
    if (!newPlan) throw new NotFoundException('Plan not found');
    if (!newPlan.isActive) throw new BadRequestException('Plan is not available');

    // Determine price ID
    const priceId = dto.cycle === BillingCycle.YEARLY
      ? newPlan.stripePriceIdYearly
      : newPlan.stripePriceIdMonthly;

    if (!priceId && dto.planType !== PlanType.FREE) {
      throw new BadRequestException('Stripe price not configured for this plan');
    }

    let stripeSubscription: Stripe.Subscription | undefined;

    if (!org.subscription?.stripeSubscriptionId && priceId) {
      // First paid subscription
      stripeSubscription = await this.stripe.createSubscription({
        stripeCustomerId: org.stripeCustomerId,
        stripePriceId: priceId,
        trialDays: 14, // 14-day trial for first upgrade
        metadata: { organizationId },
      });
    } else if (org.subscription?.stripeSubscriptionId && priceId) {
      // Upgrade/downgrade existing subscription
      stripeSubscription = await this.stripe.changeSubscriptionPlan(
        org.subscription.stripeSubscriptionId,
        org.subscription.stripeItemId!,
        priceId,
      );
    }

    const periodEnd = stripeSubscription
      ? new Date((stripeSubscription as any).current_period_end * 1000)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await this.prisma.subscription.update({
      where: { organizationId },
      data: {
        planId: newPlan.id,
        status: stripeSubscription?.status === 'trialing'
          ? SubscriptionStatus.TRIALING
          : SubscriptionStatus.ACTIVE,
        cycle: dto.cycle,
        stripeSubscriptionId: stripeSubscription?.id ?? org.subscription?.stripeSubscriptionId,
        stripeItemId: stripeSubscription?.items.data[0]?.id ?? org.subscription?.stripeItemId,
        currentPeriodEnd: periodEnd,
        trialEndAt: stripeSubscription?.trial_end
          ? new Date(stripeSubscription.trial_end * 1000)
          : null,
        currentPeriodChatsUsed: 0, // reset on plan change
        currentPeriodTokensUsed: 0,
        currentPeriodApiCallsUsed: 0,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        orgId: organizationId,
        userId: actorId,
        actorId,
        actorType: ActorType.USER,
        action: 'subscription.upgraded',
        resourceType: 'subscription',
        resourceId: organizationId,
        metadata: { fromPlan: org.subscription?.plan.type, toPlan: dto.planType, cycle: dto.cycle },
      },
    });

    return { success: true, plan: newPlan.type };
  }

  async cancelSubscription(organizationId: string, actorId: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });
    if (!sub?.stripeSubscriptionId) throw new NotFoundException('No active paid subscription');

    await this.stripe.cancelSubscription(sub.stripeSubscriptionId, true);

    await this.prisma.subscription.update({
      where: { organizationId },
      data: { cancelAtPeriodEnd: true },
    });

    await this.prisma.auditLog.create({
      data: {
        orgId: organizationId,
        userId: actorId,
        actorId,
        actorType: ActorType.USER,
        action: 'subscription.canceled',
        resourceType: 'subscription',
        resourceId: organizationId,
        metadata: {},
      },
    });

    return { success: true, message: 'Subscription will cancel at period end' };
  }

  // ─── Portal & Checkout ────────────────────────────────────

  async createUserBillingPortalSession(userId: string, returnUrl: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.stripeCustomerId) {
      throw new BadRequestException('No billing customer associated with this user');
    }

    const session = await this.stripe.createCustomerPortalSession({
      stripeCustomerId: user.stripeCustomerId,
      returnUrl,
    });
    return { url: session.url };
  }

  async createUserCheckoutSession(
    userId: string,
    planType: PlanType,
    cycle: BillingCycle,
    successUrl: string,
    cancelUrl: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    let stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await this.stripe.createCustomer({
        email: user.email,
        name: user.name || user.email,
        organizationId: '',
        metadata: { userId },
      });
      stripeCustomerId = customer.id;
      await this.prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId },
      });
    }

    const plan = await this.plans.findByType(planType);
    if (!plan) throw new NotFoundException('Plan not found');

    let priceId = plan.stripePriceId;
    if (!priceId) {
      priceId = cycle === BillingCycle.YEARLY
        ? plan.stripePriceIdYearly
        : plan.stripePriceIdMonthly;
    }

    if (!priceId) throw new BadRequestException('Plan price not configured');

    const session = await this.stripe.createCheckoutSession({
      stripeCustomerId,
      stripePriceId: priceId,
      successUrl,
      cancelUrl,
      trialDays: 14,
      metadata: { userId, planType, cycle },
    });

    return { url: session.url };
  }

  // ─── Getters ──────────────────────────────────────────────

  async getOrganizationSubscription(organizationId: string) {
    return this.prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    });
  }

  async getInvoices(organizationId: string) {
    return this.prisma.invoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async getBillingSummary(userId: string, orgId?: string) {
    // ── 1. Resolve org context ─────────────────────────────────────────────
    let resolvedOrgId = orgId;

    if (!resolvedOrgId) {
      // Fallback: find user's first/personal org
      const membership = await this.prisma.orgMember.findFirst({
        where: { userId },
        orderBy: { joinedAt: "asc" },
        select: { orgId: true },
      });
      resolvedOrgId = membership?.orgId;
    }

    // ── 2. Resolve plan (org subscription preferred) ───────────────────────
    let subscription: any = null;
    let plan: any = null;

    if (resolvedOrgId) {
      subscription = await this.prisma.subscription.findUnique({
        where: { organizationId: resolvedOrgId },
        include: { plan: true },
      });
      plan = subscription?.plan;
    }

    if (!plan) {
      const userSub = await this.prisma.subscription.findFirst({
        where: { userId },
        include: { plan: true },
        orderBy: { createdAt: "desc" },
      });
      subscription = userSub;
      plan = userSub?.plan;
    }

    if (!plan) {
      plan = await this.prisma.plan.findUnique({ where: { type: PlanType.FREE } });
    }

    // ── 3. Aggregate token + upload usage by org ───────────────────────────
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    let tokensUsed = subscription?.currentPeriodTokensUsed ?? 0;
    let uploadsUsed = 0;

    if (resolvedOrgId) {
      const uploadAgg = await this.prisma.usageRecord.aggregate({
        where: { orgId: resolvedOrgId, date: { gte: todayStart } },
        _sum: { uploadsCount: true },
      });
      uploadsUsed = uploadAgg._sum.uploadsCount ?? 0;
    } else {
      const usageRecord = await this.prisma.usageRecord.findFirst({
        where: { userId, date: { gte: todayStart } },
      });
      uploadsUsed = usageRecord?.uploadsCount ?? 0;
    }

    // ── 4. Seat usage ──────────────────────────────────────────────────────
    const seatCount = resolvedOrgId
      ? await this.prisma.orgMember.count({ where: { orgId: resolvedOrgId } })
      : 1;

    const seatLimit = plan?.maxUsers ?? null; // null = unlimited

    // ── 5. Invoices ────────────────────────────────────────────────────────
    const invoices = await this.prisma.invoice.findMany({
      where: resolvedOrgId ? { organizationId: resolvedOrgId } : { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    return {
      orgId: resolvedOrgId ?? null,
      plan: {
        id: plan?.id,
        name: plan?.name,
        type: plan?.type,
        stripePriceId: plan?.stripePriceId,
        limits: plan?.limits,
      },
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          }
        : null,
      usage: {
        tokensUsed,
        tokensLimit: (plan?.limits as any)?.maxTokensPerMonth ?? 50000,
        uploadsUsed,
        uploadsLimit: (plan?.limits as any)?.maxDocuments ?? 5,
        seatCount,
        seatLimit,
      },
      invoices: invoices.map((inv) => ({
        id: inv.id,
        stripeInvoiceId: inv.stripeInvoiceId,
        status: inv.status,
        amountDueUsdCents: inv.amountDueUsdCents,
        amountPaidUsdCents: inv.amountPaidUsdCents,
        hostedInvoiceUrl: inv.hostedInvoiceUrl,
        invoicePdfUrl: inv.invoicePdfUrl,
        createdAt: inv.createdAt,
      })),
    };
  }
}

