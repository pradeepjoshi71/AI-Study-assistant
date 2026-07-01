import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { StripeService } from "../billing/stripe.service";

@Injectable()
export class RewardService {
  private readonly logger = new Logger(RewardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    @InjectQueue("referral-reward") private readonly referralQueue: Queue,
  ) {}

  @OnEvent("referral.converted")
  async handleReferralConverted(event: { referralId: string }) {
    const { referralId } = event;
    this.logger.log(`Handling converted referral: ${referralId}`);

    const referral = await this.prisma.referral.findUnique({
      where: { id: referralId },
      include: {
        referrer: {
          include: {
            sessions: true,
          },
        },
        referee: {
          include: {
            sessions: true,
          },
        },
      },
    });

    if (!referral || !referral.referee) {
      this.logger.warn(`Referral or referee not found for ID: ${referralId}`);
      return;
    }

    const { referrer, referee } = referral;

    // ─── Fraud Checks ────────────────────────────────────────────────────────
    const referrerDomain = referrer.email.split("@")[1]?.toLowerCase();
    const refereeDomain = referee.email.split("@")[1]?.toLowerCase();

    // 1. Check email domain matching
    const isSameDomain = referrerDomain && refereeDomain && referrerDomain === refereeDomain;

    // 2. Check same IP (compare referral IP with referrer's session IPs)
    const referrerIps = referrer.sessions.map((s) => s.ipAddress).filter(Boolean);
    const isSameIp = referral.ip && referrerIps.includes(referral.ip);

    // 3. Check device fingerprint matching
    // (If referral has a deviceFingerprint and it matches referrer's known deviceFingerprint, or if they match)
    const isSameFingerprint =
      referral.deviceFingerprint &&
      referee.sessions.some(
        (refereeSession) =>
          referrer.sessions.some(
            (referrerSession) =>
              referrerSession.userAgent === refereeSession.userAgent &&
              referrerSession.ipAddress === refereeSession.ipAddress
          )
      );

    if (isSameDomain || isSameIp || isSameFingerprint) {
      this.logger.warn(`Fraud detected for referral ${referralId}. Same domain: ${isSameDomain}, Same IP: ${isSameIp}, Same device fingerprint signature: ${isSameFingerprint}`);
      await this.prisma.referral.update({
        where: { id: referralId },
        data: { status: "FRAUD" },
      });
      return;
    }

    // ─── Create Referral Reward for Referrer ───────────────────────────────
    const holdUntil = new Date();
    holdUntil.setDate(holdUntil.getDate() + 14); // hold for 14 days

    await this.prisma.referralReward.create({
      data: {
        referralId: referral.id,
        type: "CREDIT",
        amount: 10.0, // 1000 cents = $10.00
        status: "HELD",
        holdUntil,
      },
    });

    // ─── Create Stripe Coupon for Referee ──────────────────────────────────
    try {
      if (referee.stripeCustomerId) {
        const coupon = await this.stripe.client.coupons.create({
          percent_off: 20,
          duration: "once",
          name: `20% Off Referee Discount - Ref: ${referral.code}`,
        });

        await this.stripe.client.customers.update(referee.stripeCustomerId, {
          coupon: coupon.id,
        } as any);

        this.logger.log(`Successfully applied 20% off coupon ${coupon.id} to referee ${referee.id}`);
      } else {
        this.logger.warn(`Referee ${referee.id} does not have a Stripe Customer ID yet, coupon skip.`);
      }
    } catch (err: any) {
      this.logger.error(`Failed to apply Stripe coupon for referee ${referee.id}: ${err.message}`);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyPayoutCron() {
    this.logger.log("Running daily referral rewards hold release and payout cron...");

    // 1. Release HELD rewards to PENDING if hold period expired
    const released = await this.prisma.referralReward.updateMany({
      where: {
        status: "HELD",
        holdUntil: {
          lt: new Date(),
        },
      },
      data: {
        status: "PENDING",
      },
    });

    this.logger.log(`Released ${released.count} rewards from HELD to PENDING.`);

    // 2. Query all pending rewards
    const pendingRewards = await this.prisma.referralReward.findMany({
      where: { status: "PENDING" },
      include: {
        referral: {
          include: {
            referrer: {
              include: {
                affiliateAccount: true,
              },
            },
          },
        },
      },
    });

    // Group pending rewards by referrer
    const referrerRewardsMap = new Map<string, typeof pendingRewards>();
    for (const reward of pendingRewards) {
      const referrerId = reward.referral.referrerId;
      if (!referrerRewardsMap.has(referrerId)) {
        referrerRewardsMap.set(referrerId, []);
      }
      referrerRewardsMap.get(referrerId)!.push(reward);
    }

    // Process each referrer's payouts
    for (const [referrerId, rewards] of referrerRewardsMap.entries()) {
      const totalPendingRewardAmount = rewards.reduce((sum, r) => sum + r.amount, 0); // stored as Float (e.g. $10.00)

      let affiliate = await this.prisma.affiliateAccount.findUnique({
        where: { userId: referrerId },
      });

      if (!affiliate) {
        affiliate = await this.prisma.affiliateAccount.create({
          data: {
            userId: referrerId,
            balance: 0,
            totalEarned: 0,
          },
        });
      }

      const totalAccumulatedCents = Math.round((affiliate.balance + totalPendingRewardAmount) * 100);

      // Check if threshold of 5000 cents ($50.00) is reached and Stripe Connect ID is present
      if (affiliate.stripeConnectId && totalAccumulatedCents >= 5000) {
        // Dispatch payout job to BullMQ queue
        await this.referralQueue.add("payout-transfer", {
          referrerId,
          stripeConnectId: affiliate.stripeConnectId,
          amountCents: totalAccumulatedCents,
          rewardIds: rewards.map((r) => r.id),
        });
        this.logger.log(`Dispatched payout job of ${totalAccumulatedCents} cents for referrer ${referrerId}`);
      } else {
        // Accumulate balance in AffiliateAccount and keep rewards in PENDING
        await this.prisma.affiliateAccount.update({
          where: { userId: referrerId },
          data: {
            balance: affiliate.balance + totalPendingRewardAmount,
          },
        });
        this.logger.log(`Accumulated ${totalPendingRewardAmount} to referrer ${referrerId}'s balance. New balance: ${affiliate.balance + totalPendingRewardAmount}`);
      }
    }
  }
}
