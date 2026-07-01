import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule } from "@nestjs/config";
import { ReferralController } from "./referral.controller";
import { ReferralService } from "./referral.service";
import { ReferralRewardProcessor } from "./processors/referral-reward.processor";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    BullModule.registerQueue({ name: "referral-reward" }),
  ],
  controllers: [ReferralController],
  providers: [ReferralService, ReferralRewardProcessor],
  exports: [ReferralService],
})
export class ReferralModule {}
