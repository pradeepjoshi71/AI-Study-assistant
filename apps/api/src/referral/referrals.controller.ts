import { Controller, Get, Post, UseGuards, Req } from "@nestjs/common";
import { customAlphabet } from "nanoid";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/guards/jwt.guard";

const generateReferralCode = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 8);

@Controller("referrals")
@UseGuards(JwtAuthGuard)
export class ReferralsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("code")
  async getReferralCode(@Req() req: any) {
    const userId = req.user.id;

    let referralCode = await this.prisma.referralCode.findUnique({
      where: { userId },
    });

    if (!referralCode) {
      // Generate a new code and save it
      let code = generateReferralCode();
      // Ensure uniqueness
      let attempts = 0;
      while (attempts < 5) {
        const exists = await this.prisma.referralCode.findUnique({ where: { code } });
        if (!exists) break;
        code = generateReferralCode();
        attempts++;
      }

      referralCode = await this.prisma.referralCode.create({
        data: {
          userId,
          code,
        },
      });
    }

    return referralCode;
  }

  @Post("code")
  async createReferralCode(@Req() req: any) {
    const userId = req.user.id;

    // Delete existing code if any (since one-to-one)
    await this.prisma.referralCode.deleteMany({
      where: { userId },
    });

    let code = generateReferralCode();
    let attempts = 0;
    while (attempts < 5) {
      const exists = await this.prisma.referralCode.findUnique({ where: { code } });
      if (!exists) break;
      code = generateReferralCode();
      attempts++;
    }

    const referralCode = await this.prisma.referralCode.create({
      data: {
        userId,
        code,
      },
    });

    return referralCode;
  }

  @Get("stats")
  async getStats(@Req() req: any) {
    const userId = req.user.id;

    const clicks = await this.prisma.referral.count({
      where: { referrerId: userId },
    });

    const signups = await this.prisma.referral.count({
      where: {
        referrerId: userId,
        refereeId: { not: null },
      },
    });

    const conversions = await this.prisma.referral.count({
      where: {
        referrerId: userId,
        status: { in: ["CONVERTED", "REWARDED"] },
      },
    });

    return {
      clicks,
      signups,
      conversions,
    };
  }

  @Get("payouts")
  async getPayouts(@Req() req: any) {
    const userId = req.user.id;

    let affiliate = await this.prisma.affiliateAccount.findUnique({
      where: { userId },
    });

    if (!affiliate) {
      affiliate = await this.prisma.affiliateAccount.create({
        data: {
          userId,
          balance: 0.0,
          totalEarned: 0.0,
        },
      });
    }

    const rewards = await this.prisma.referralReward.findMany({
      where: {
        referral: {
          referrerId: userId,
        },
      },
      include: {
        referral: {
          include: {
            referee: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      affiliate,
      rewards,
    };
  }
}
