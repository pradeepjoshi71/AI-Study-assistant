import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { StripeService } from "../billing/stripe.service";
import { StorageService } from "../storage/storage.service";
import { CacheService } from "../common/services/cache.service";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { Cron, CronExpression } from "@nestjs/schedule";

export interface CreateTenantDto {
  name: string;
  subdomain: string;
  customDomain?: string;
  planId: string;
  appName?: string;
  supportEmail: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  fontFamily?: string;
  features?: any;
  orgName?: string;
  orgSlug?: string;
}

export interface UpdateConfigDto {
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  fontFamily?: string;
  appName?: string;
  supportEmail?: string;
  features?: any;
  customCss?: string;
}

@Injectable()
export class ResellerService {
  private readonly logger = new Logger(ResellerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly storageService: StorageService,
    private readonly cache: CacheService,
    @InjectQueue("email") private readonly emailQueue: Queue,
  ) {}

  // ── Create Tenant ──────────────────────────────────────────────────────────

  async createTenant(userId: string, dto: CreateTenantDto) {
    // 1. Verify ResellerAccount exists for current user
    const reseller = await this.prisma.resellerAccount.findUnique({
      where: { userId },
    });
    if (!reseller) {
      throw new ForbiddenException("Only reseller accounts can create tenants");
    }

    // 2. Count existing tenants referred by this reseller
    const currentTenantCount = await this.prisma.tenant.count({
      where: { resellerId: reseller.userId },
    });

    // 3. Fetch TenantPlan and validate count vs plan.maxOrgs
    const plan = await this.prisma.tenantPlan.findUnique({
      where: { id: dto.planId },
    });
    if (!plan) {
      throw new NotFoundException(`TenantPlan with ID "${dto.planId}" not found`);
    }

    if (currentTenantCount >= plan.maxOrgs) {
      throw new BadRequestException(
        `Reseller has reached the maximum tenant count (${plan.maxOrgs}) allowed by plan "${plan.name}"`,
      );
    }

    // Check subdomain uniqueness
    const subExists = await this.prisma.tenant.findUnique({
      where: { subdomain: dto.subdomain.toLowerCase() },
    });
    if (subExists) {
      throw new BadRequestException(`Subdomain "${dto.subdomain}" is already taken`);
    }

    if (dto.customDomain) {
      const domExists = await this.prisma.tenant.findUnique({
        where: { customDomain: dto.customDomain },
      });
      if (domExists) {
        throw new BadRequestException(`Custom domain "${dto.customDomain}" is already mapped`);
      }
    }

    // 4. Create Tenant, TenantConfig, and Organization in transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          resellerId: reseller.userId,
          name: dto.name,
          subdomain: dto.subdomain.toLowerCase(),
          customDomain: dto.customDomain || null,
          status: "TRIAL",
          planId: plan.id,
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // now + 14 days
        },
      });

      const config = await tx.tenantConfig.create({
        data: {
          tenantId: tenant.id,
          logoUrl: dto.logoUrl || null,
          primaryColor: dto.primaryColor || "#6366f1",
          secondaryColor: dto.secondaryColor || "#8b5cf6",
          fontFamily: dto.fontFamily || "Inter",
          appName: dto.appName || dto.name,
          supportEmail: dto.supportEmail,
          features: dto.features || {
            marketplace: false,
            voice: false,
            groups: true,
            api_access: false,
            custom_branding: false,
          },
        },
      });

      const organization = await tx.organization.create({
        data: {
          name: dto.orgName || `${dto.name} Org`,
          slug: dto.orgSlug || `${dto.subdomain.toLowerCase()}-org-${Math.floor(1000 + Math.random() * 9000)}`,
          tenantId: tenant.id,
        },
      });

      return { tenant, config, organization };
    });

    // 5. Create Stripe Customer and Subscription for reseller
    const resellerUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!resellerUser) {
      throw new NotFoundException("Reseller user profile not found");
    }

    let stripeCustomerId = resellerUser.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await this.stripeService.client.customers.create({
        email: resellerUser.email,
        name: resellerUser.name || resellerUser.email,
        metadata: { resellerUserId: resellerUser.id },
      });
      stripeCustomerId = customer.id;
      await this.prisma.user.update({
        where: { id: resellerUser.id },
        data: { stripeCustomerId },
      });
    }

    // Dynamically provision product & price on Stripe
    const product = await this.stripeService.client.products.create({
      name: `Tenant Plan: ${plan.name}`,
    });
    const price = await this.stripeService.client.prices.create({
      unit_amount: plan.price,
      currency: "usd",
      recurring: { interval: "month" },
      product: product.id,
    });

    await this.stripeService.createSubscription({
      stripeCustomerId,
      stripePriceId: price.id,
      metadata: { tenantId: result.tenant.id },
    });

    // 6. Dispatch welcome email via BullMQ
    const tenantUrl = `https://${result.tenant.subdomain}.studyapp.com`;
    await this.emailQueue.add("welcome-reseller-tenant", {
      to: resellerUser.email,
      subject: `Tenant Provisioned successfully: ${result.tenant.name}`,
      body: `Hi Reseller,\n\nYour new client tenant workspace has been set up successfully!\n\nWorkspace Subdomain: ${tenantUrl}\nPlan: ${plan.name}\nTrial Ends On: ${result.tenant.trialEndsAt?.toLocaleDateString()}`,
    });

    return result;
  }

  // ── Update Config & Upload Logo ────────────────────────────────────────────

  async updateTenantConfig(
    tenantId: string,
    dto: UpdateConfigDto,
    logoFile?: Express.Multer.File,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant with ID "${tenantId}" not found`);
    }

    let finalLogoUrl = dto.logoUrl;

    // 1. Upload logo to Minio if provided
    if (logoFile) {
      const key = `tenants/${tenantId}/logo.png`;
      const uploadResult = await this.storageService.uploadBuffer(
        key,
        logoFile.buffer,
        logoFile.mimetype,
      );
      finalLogoUrl = uploadResult.url;
    }

    // 2. Update config fields
    const updatedConfig = await this.prisma.tenantConfig.update({
      where: { tenantId },
      data: {
        logoUrl: finalLogoUrl || undefined,
        primaryColor: dto.primaryColor,
        secondaryColor: dto.secondaryColor,
        fontFamily: dto.fontFamily,
        appName: dto.appName,
        supportEmail: dto.supportEmail,
        features: dto.features,
        customCss: dto.customCss,
      },
    });

    // 3. Flush Redis tenant cache
    await this.cache.del(`tenant:sub:${tenant.subdomain}`);
    if (tenant.customDomain) {
      await this.cache.del(`tenant:domain:${tenant.customDomain}`);
    }

    return updatedConfig;
  }

  // ── Daily Cron: Trial Expiration Checks ────────────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async checkExpiredTrials() {
    this.logger.log("Checking for expired tenant trial periods...");

    const expiredTenants = await this.prisma.tenant.findMany({
      where: {
        status: "TRIAL",
        trialEndsAt: { lt: new Date() },
      },
    });

    if (expiredTenants.length === 0) {
      this.logger.log("No trials expired today.");
      return;
    }

    for (const tenant of expiredTenants) {
      try {
        // Suspend tenant
        await this.prisma.tenant.update({
          where: { id: tenant.id },
          data: { status: "SUSPENDED" },
        });

        // Flush cache
        await this.cache.del(`tenant:sub:${tenant.subdomain}`);
        if (tenant.customDomain) {
          await this.cache.del(`tenant:domain:${tenant.customDomain}`);
        }

        // Notify reseller
        const resellerUser = await this.prisma.user.findFirst({
          where: { id: tenant.resellerId },
        });

        if (resellerUser) {
          await this.emailQueue.add("trial-expired-notification", {
            to: resellerUser.email,
            subject: `Action Required: Trial period expired for ${tenant.name}`,
            body: `Dear Reseller,\n\nThe 14-day trial period for your tenant "${tenant.name}" (${tenant.subdomain}.studyapp.com) has expired.\n\nThe tenant has been suspended automatically. To reactivate access, please purchase an active subscription for this tenant in your portal.`,
          });
        }

        this.logger.log(`Suspended expired trial tenant: "${tenant.name}" (${tenant.id})`);
      } catch (err) {
        this.logger.error(`Failed suspending tenant "${tenant.id}":`, err);
      }
    }
  }

  // ── Subdomain Check ────────────────────────────────────────────────────────

  async checkSubdomain(subdomain: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { subdomain: subdomain.toLowerCase() },
    });
    return { available: !tenant };
  }

  // ── Dashboard Metrics ──────────────────────────────────────────────────────

  async getDashboard(userId: string) {
    const reseller = await this.prisma.resellerAccount.findUnique({
      where: { userId },
    });
    if (!reseller) {
      throw new ForbiddenException("Only resellers can access the dashboard");
    }

    const tenants = await this.prisma.tenant.findMany({
      where: { resellerId: reseller.userId },
      include: { plan: true, billing: true, config: true },
    });

    const plans = await this.prisma.tenantPlan.findMany();

    const activeTenants = tenants.filter((t) => t.status === "ACTIVE").length;
    const trialCount = tenants.filter((t) => t.status === "TRIAL").length;
    const totalMrr = tenants
      .filter((t) => t.status === "ACTIVE")
      .reduce((sum, t) => sum + (t.plan?.price || 0), 0);

    return {
      stats: {
        activeTenants,
        trialCount,
        totalMRR: totalMrr,
      },
      tenants: tenants.map((t) => ({
        id: t.id,
        name: t.name,
        subdomain: t.subdomain,
        customDomain: t.customDomain,
        status: t.status,
        plan: t.plan,
        config: t.config,
        billingStatus: t.billing?.status || "TRIAL",
        userCount: 4, // mock count
        aiTokensUsed: 3500, // mock usage
      })),
      plans,
    };
  }

  // ── Tenant Details ─────────────────────────────────────────────────────────

  async getTenantDetails(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { plan: true, config: true, billing: true },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant with ID "${tenantId}" not found`);
    }

    return {
      id: tenant.id,
      name: tenant.name,
      subdomain: tenant.subdomain,
      customDomain: tenant.customDomain,
      status: tenant.status,
      plan: tenant.plan,
      config: tenant.config,
      billing: tenant.billing,
      usage: {
        users: 3, // mock
        maxUsers: tenant.plan.maxUsersPerOrg,
        docs: 8, // mock
        maxDocs: tenant.plan.maxDocsPerOrg,
        tokens: 15000, // mock
        maxTokens: tenant.plan.aiTokensPerMonth,
      },
    };
  }

  // ── Suspend Tenant ─────────────────────────────────────────────────────────

  async suspendTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException("Tenant not found");

    const newStatus = tenant.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status: newStatus },
    });

    // Flush cache
    await this.cache.del(`tenant:sub:${tenant.subdomain}`);
    if (tenant.customDomain) {
      await this.cache.del(`tenant:domain:${tenant.customDomain}`);
    }

    return updated;
  }

  // ── Delete Tenant ──────────────────────────────────────────────────────────

  async deleteTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException("Tenant not found");

    await this.prisma.tenant.delete({
      where: { id: tenantId },
    });

    // Flush cache
    await this.cache.del(`tenant:sub:${tenant.subdomain}`);
    if (tenant.customDomain) {
      await this.cache.del(`tenant:domain:${tenant.customDomain}`);
    }

    return { success: true };
  }
}
