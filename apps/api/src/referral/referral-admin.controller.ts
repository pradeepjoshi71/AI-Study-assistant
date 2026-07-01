import { Controller, Get, Post, Param, UseGuards, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/guards/jwt.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "@prisma/client";
import { RewardService } from "./reward.service";

@Controller("admin/referrals")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ReferralAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rewardService: RewardService,
  ) {}

  @Get("fraud")
  async getFraudReferrals() {
    return this.prisma.referral.findMany({
      where: { status: "FRAUD" },
      include: {
        referrer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        referee: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  @Post(":id/approve")
  async approveFraudReferral(@Param("id") id: string) {
    const referral = await this.prisma.referral.findUnique({
      where: { id },
    });

    if (!referral) {
      throw new BadRequestException("Referral not found");
    }

    if (referral.status !== "FRAUD") {
      throw new BadRequestException("Only FRAUD flagged referrals can be manually approved");
    }

    // Update status to CONVERTED
    await this.prisma.referral.update({
      where: { id },
      data: {
        status: "CONVERTED",
        convertedAt: new Date(),
      },
    });

    // Create a ReferralReward immediately ready for payout (PENDING) with holdUntil = now
    const reward = await this.prisma.referralReward.create({
      data: {
        referralId: id,
        type: "CREDIT",
        amount: 10.0, // $10.00 / 1000 cents
        status: "PENDING",
        holdUntil: new Date(),
      },
    });

    return {
      message: "Referral fraud flag cleared. Reward created as PENDING.",
      reward,
    };
  }

  @Post(":id/reject")
  async rejectFraudReferral(@Param("id") id: string) {
    const referral = await this.prisma.referral.findUnique({
      where: { id },
    });

    if (!referral) {
      throw new BadRequestException("Referral not found");
    }

    // Ensure status remains FRAUD (or update explicitly to keep track)
    await this.prisma.referral.update({
      where: { id },
      data: {
        status: "FRAUD",
      },
    });

    return {
      message: "Referral fraud flag permanently rejected.",
    };
  }

  @Post("payout")
  async triggerPayout() {
    // Manually run the daily cron payout process
    await this.rewardService.handleDailyPayoutCron();
    return {
      message: "Daily payout processing run successfully triggered.",
    };
  }
}
