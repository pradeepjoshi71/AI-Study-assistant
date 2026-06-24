import { IsEnum, IsOptional } from 'class-validator';
import { BillingCycle, PlanType } from '@prisma/client';

export class UpgradeSubscriptionDto {
  @IsEnum(PlanType)
  planType!: PlanType;

  @IsEnum(BillingCycle)
  @IsOptional()
  cycle: BillingCycle = BillingCycle.MONTHLY;
}
