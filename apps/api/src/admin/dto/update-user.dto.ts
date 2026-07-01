import { IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { SystemRole, SubscriptionPlan } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsEnum(SystemRole)
  systemRole?: SystemRole;

  /** true = active, false = deactivated */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsEnum(SubscriptionPlan)
  plan?: SubscriptionPlan;
}
