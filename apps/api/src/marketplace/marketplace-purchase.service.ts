import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { StripeService } from "../billing/stripe.service";
import { CacheService } from "../common/services/cache.service";
import Stripe from "stripe";

/** TTL for purchase unlock cache — 24 hours */
const PURCHASE_CACHE_TTL = 86400;

@Injectable()
export class MarketplacePurchaseService {
  private readonly logger = new Logger(MarketplacePurchaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly cache: CacheService,
  ) {}

  // ── Purchase Intent Creation ────────────────────────────────────────────────

  /**
   * Creates a Stripe PaymentIntent for a marketplace listing purchase.
   * Validates the listing is PUBLISHED and the buyer has not already purchased.
   */
  async createPaymentIntent(
    listingId: string,
    buyerId: string,
  ): Promise<{ clientSecret: string; paymentIntentId: string }> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!listing) {
      throw new Error(`Listing ${listingId} not found`);
    }
    if (listing.status !== "PUBLISHED") {
      throw new Error(`Listing ${listingId} is not available for purchase (status: ${listing.status})`);
    }

    // Check existing purchase (cache-first)
    const alreadyOwned = await this.hasPurchased(buyerId, listingId);
    if (alreadyOwned) {
      throw new Error("You have already purchased this listing");
    }

    // Create Stripe PaymentIntent
    const paymentIntent = await this.stripe.client.paymentIntents.create({
      amount: listing.price, // already in cents
      currency: "usd",
      metadata: {
        listingId,
        buyerId,
        listingTitle: listing.title,
      },
    });

    this.logger.log(
      `Created PaymentIntent ${paymentIntent.id} for listing ${listingId} (${listing.price} cents) by buyer ${buyerId}`,
    );

    return {
      clientSecret: paymentIntent.client_secret!,
      paymentIntentId: paymentIntent.id,
    };
  }

  // ── Webhook Event Handler ───────────────────────────────────────────────────

  /**
   * Handles the payment_intent.succeeded webhook event (emitted by WebhookHandler).
   * Idempotent — safe to call multiple times for the same PaymentIntent.
   */
  @OnEvent("marketplace.payment_intent.succeeded", { async: true })
  async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const { listingId, buyerId } = paymentIntent.metadata ?? {};

    if (!listingId || !buyerId) {
      // Not a marketplace purchase — ignore
      return;
    }

    this.logger.log(
      `Processing marketplace payment_intent.succeeded: PI=${paymentIntent.id}, listing=${listingId}, buyer=${buyerId}`,
    );

    // ── Idempotency: skip if Purchase already recorded ─────────────────────
    const existingPurchase = await this.prisma.purchase.findUnique({
      where: { stripePaymentId: paymentIntent.id },
    });

    if (existingPurchase) {
      this.logger.debug(
        `Purchase already recorded for PaymentIntent ${paymentIntent.id} — skipping`,
      );
      return;
    }

    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { price: true, creatorId: true },
    });

    if (!listing) {
      this.logger.warn(`Listing ${listingId} not found during payment processing`);
      return;
    }

    const creatorAmount = Math.round(listing.price * 0.7); // 70% to creator
    const platformAmount = Math.round(listing.price * 0.3); // 30% platform fee
    const holdUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // now + 7 days

    // ── Create Purchase + CreatorPayout in a single transaction ───────────
    await this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({
        data: {
          buyerId,
          listingId,
          amountPaid: listing.price,
          stripePaymentId: paymentIntent.id,
          status: "COMPLETED",
        },
      });

      await tx.creatorPayout.create({
        data: {
          listingId,
          purchaseId: purchase.id,
          creatorAmount,
          platformAmount,
          status: "HELD",
          holdUntil,
        },
      });

      // Increment listing salesCount
      await tx.listing.update({
        where: { id: listingId },
        data: { salesCount: { increment: 1 } },
      });
    });

    this.logger.log(
      `Purchase COMPLETED for listing ${listingId} by buyer ${buyerId}. ` +
        `Creator gets ${creatorAmount}¢, Platform gets ${platformAmount}¢. Payout held until ${holdUntil.toISOString()}`,
    );

    // ── Cache purchase unlock key (24hr) ────────────────────────────────
    await this.cache.set(
      CacheService.purchaseKey(buyerId, listingId),
      true,
      PURCHASE_CACHE_TTL,
    );
  }

  // ── Access Check ───────────────────────────────────────────────────────────

  /**
   * Returns true if the buyer has purchased the listing.
   * Cache-first: Redis → DB fallback.
   */
  async hasPurchased(buyerId: string, listingId: string): Promise<boolean> {
    const cacheKey = CacheService.purchaseKey(buyerId, listingId);

    const cached = await this.cache.get<boolean>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const purchase = await this.prisma.purchase.findFirst({
      where: { buyerId, listingId, status: "COMPLETED" },
      select: { id: true },
    });

    const owned = purchase !== null;

    // Warm the cache if found
    if (owned) {
      await this.cache.set(cacheKey, true, PURCHASE_CACHE_TTL);
    }

    return owned;
  }

  // ── Daily Creator Payout Cron ───────────────────────────────────────────────

  /**
   * Runs daily at midnight.
   * Processes all CreatorPayouts where status=HELD and holdUntil < now.
   * Executes Stripe Connect transfer → status=PAID. On failure → status=FAILED.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyCreatorPayouts(): Promise<void> {
    this.logger.log("Running daily marketplace creator payout cron...");

    const now = new Date();

    const duepayouts = await this.prisma.creatorPayout.findMany({
      where: {
        status: "HELD",
        holdUntil: { lt: now },
      },
      include: {
        listing: {
          select: {
            creatorId: true,
            title: true,
          },
        },
      },
    });

    if (duepayouts.length === 0) {
      this.logger.log("No creator payouts due today.");
      return;
    }

    this.logger.log(`Processing ${duepayouts.length} due creator payout(s)...`);

    for (const payout of duepayouts) {
      const creatorId = payout.listing.creatorId;

      try {
        // Fetch creator's AffiliateAccount for Stripe Connect ID
        const affiliate = await this.prisma.affiliateAccount.findUnique({
          where: { userId: creatorId },
        });

        if (!affiliate?.stripeConnectId) {
          this.logger.warn(
            `Creator ${creatorId} has no Stripe Connect account — skipping payout ${payout.id}. ` +
              `Accumulating ${payout.creatorAmount}¢ until Connect account is linked.`,
          );
          // Accumulate balance without paying out
          await this.prisma.affiliateAccount.upsert({
            where: { userId: creatorId },
            create: {
              userId: creatorId,
              balance: payout.creatorAmount / 100,
              totalEarned: payout.creatorAmount / 100,
            },
            update: {
              balance: { increment: payout.creatorAmount / 100 },
              totalEarned: { increment: payout.creatorAmount / 100 },
            },
          });
          continue;
        }

        // Execute Stripe Connect transfer
        const transfer = await this.stripe.client.transfers.create({
          amount: payout.creatorAmount,
          currency: "usd",
          destination: affiliate.stripeConnectId,
          description: `Marketplace payout for listing: ${payout.listing.title} (payout: ${payout.id})`,
          metadata: {
            payoutId: payout.id,
            listingId: payout.listingId,
            creatorId,
          },
        });

        // Mark payout as PAID
        await this.prisma.creatorPayout.update({
          where: { id: payout.id },
          data: {
            status: "PAID",
            paidAt: new Date(),
          },
        });

        // Update AffiliateAccount totals
        await this.prisma.affiliateAccount.upsert({
          where: { userId: creatorId },
          create: {
            userId: creatorId,
            balance: 0,
            totalEarned: payout.creatorAmount / 100,
          },
          update: {
            totalEarned: { increment: payout.creatorAmount / 100 },
          },
        });

        this.logger.log(
          `Paid ${payout.creatorAmount}¢ to creator ${creatorId} via Stripe Transfer ${transfer.id} for payout ${payout.id}`,
        );
      } catch (err: any) {
        this.logger.error(
          `Failed to process payout ${payout.id} for creator ${creatorId}: ${err.message}`,
        );

        // Mark as FAILED so it can be retried or manually reviewed
        await this.prisma.creatorPayout.update({
          where: { id: payout.id },
          data: { status: "FAILED" },
        }).catch(() => {});
      }
    }

    this.logger.log("Daily marketplace creator payout cron completed.");
  }
}
