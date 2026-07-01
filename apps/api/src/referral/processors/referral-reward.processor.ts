import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger, Injectable } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { StripeService } from "../../billing/stripe.service";

@Injectable()
@Processor("referral-reward", { concurrency: 2 })
export class ReferralRewardProcessor extends WorkerHost {
  private readonly logger = new Logger(ReferralRewardProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {
    super();
  }

  async process(job: Job<any>): Promise<void> {
    if (job.name === "payout-transfer") {
      await this.handlePayoutTransfer(job);
    } else {
      await this.handleLegacyProcessReward(job);
    }
  }

  private async handlePayoutTransfer(job: Job<any>): Promise<void> {
    const { referrerId, stripeConnectId, amountCents, rewardIds } = job.data;
    this.logger.log(`Processing payout transfer of ${amountCents} cents to Stripe Connect Account ${stripeConnectId} for referrer ${referrerId}`);

    try {
      // 1. Trigger Stripe Connect Transfer
      const transfer = await this.stripe.client.transfers.create({
        amount: amountCents,
        currency: "usd",
        destination: stripeConnectId,
        description: `Affiliate balance payout for referrer: ${referrerId}`,
      });

      this.logger.log(`Stripe Transfer successful: ${transfer.id}`);

      // 2. Reset Affiliate Balance and increment total earned
      const affiliate = await this.prisma.affiliateAccount.findUnique({
        where: { userId: referrerId },
      });

      const amountDollars = amountCents / 100.0;

      if (affiliate) {
        await this.prisma.affiliateAccount.update({
          where: { userId: referrerId },
          data: {
            balance: 0.0,
            totalEarned: affiliate.totalEarned + amountDollars,
          },
        });
      }

      // 3. Mark rewards as PAID
      await this.prisma.referralReward.updateMany({
        where: {
          id: { in: rewardIds },
        },
        data: {
          status: "PAID",
          paidAt: new Date(),
        },
      });

      this.logger.log(`Successfully completed payout transfer of ${amountCents} cents for referrer ${referrerId}`);
    } catch (err: any) {
      this.logger.error(`Stripe Transfer failed for referrer ${referrerId} to Stripe account ${stripeConnectId}: ${err.message}`);
      throw err; // Re-throw to allow BullMQ to retry if needed
    }
  }

  private async handleLegacyProcessReward(job: Job<any>): Promise<void> {
    const { referralId } = job.data;
    this.logger.log(`Processing legacy referral reward for referral: ${referralId}`);

    const referral = await this.prisma.referral.findUnique({
      where: { id: referralId },
    });

    if (!referral) {
      this.logger.warn(`Referral record ${referralId} not found`);
      return;
    }

    if (referral.status !== "CONVERTED") {
      this.logger.warn(`Referral record ${referralId} status is not CONVERTED (status: ${referral.status})`);
      return;
    }

    const existingReward = await this.prisma.referralReward.findFirst({
      where: { referralId },
    });

    if (existingReward) {
      this.logger.warn(`Reward already exists for referral ${referralId}`);
      return;
    }

    const holdDays = 14;
    const holdUntil = new Date();
    holdUntil.setDate(holdUntil.getDate() + holdDays);

    const reward = await this.prisma.referralReward.create({
      data: {
        referralId,
        type: "CREDIT",
        amount: 10.0,
        status: "PENDING",
        holdUntil,
      },
    });

    const affiliate = await this.prisma.affiliateAccount.findUnique({
      where: { userId: referral.referrerId },
    });

    if (affiliate) {
      await this.prisma.affiliateAccount.update({
        where: { userId: referral.referrerId },
        data: {
          balance: affiliate.balance + 10.0,
          totalEarned: affiliate.totalEarned + 10.0,
        },
      });
    } else {
      await this.prisma.affiliateAccount.create({
        data: {
          userId: referral.referrerId,
          balance: 10.0,
          totalEarned: 10.0,
        },
      });
    }

    await this.prisma.referral.update({
      where: { id: referralId },
      data: { status: "REWARDED" },
    });

    this.logger.log(`Successfully created reward ${reward.id} and updated referrer affiliate account stats.`);
  }
}
