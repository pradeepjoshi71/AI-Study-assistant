import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger, Injectable } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";

export interface ReferralRewardJobData {
  referralId: string;
}

@Injectable()
@Processor("referral-reward", { concurrency: 2 })
export class ReferralRewardProcessor extends WorkerHost {
  private readonly logger = new Logger(ReferralRewardProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<ReferralRewardJobData>): Promise<void> {
    const { referralId } = job.data;
    this.logger.log(`Processing referral reward for referral: ${referralId}`);

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

    // Check if reward already exists to prevent duplicate rewards
    const existingReward = await this.prisma.referralReward.findFirst({
      where: { referralId },
    });

    if (existingReward) {
      this.logger.warn(`Reward already exists for referral ${referralId}`);
      return;
    }

    // Create the reward (e.g. $10.00 credit with a 14-day hold)
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

    // Also update AffiliateAccount or statistics if needed
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
      // Create affiliate account for the referrer if it doesn't exist
      await this.prisma.affiliateAccount.create({
        data: {
          userId: referral.referrerId,
          balance: 10.0,
          totalEarned: 10.0,
        },
      });
    }

    // Update referral status to REWARDED
    await this.prisma.referral.update({
      where: { id: referralId },
      data: { status: "REWARDED" },
    });

    this.logger.log(`Successfully created reward ${reward.id} and updated referrer affiliate account stats.`);
  }
}
