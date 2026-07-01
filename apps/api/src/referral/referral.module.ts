import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule } from "@nestjs/config";
import { ReferralController } from "./referral.controller";
import { ReferralsController } from "./referrals.controller";
import { ReferralAdminController } from "./referral-admin.controller";
import { ReferralService } from "./referral.service";
import { RewardService } from "./reward.service";
import { ReferralRewardProcessor } from "./processors/referral-reward.processor";
import { PrismaModule } from "../prisma/prisma.module";
import { BillingModule } from "../billing/billing.module";

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    BillingModule,
    BullModule.registerQueue({ name: "referral-reward" }),
  ],
  controllers: [ReferralController, ReferralsController, ReferralAdminController],
  providers: [ReferralService, RewardService, ReferralRewardProcessor],
  exports: [ReferralService, RewardService],
})
export class ReferralModule {}
