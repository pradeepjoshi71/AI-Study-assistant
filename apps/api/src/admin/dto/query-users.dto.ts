import {
  IsOptional,
  IsString,
  IsEnum,
  IsInt,
  IsISO8601,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SystemRole, SubscriptionPlan } from '@prisma/client';

export class QueryUsersDto {
  @IsOptional()
  @IsEnum(SubscriptionPlan)
  plan?: SubscriptionPlan;

  @IsOptional()
  @IsEnum(SystemRole)
  systemRole?: SystemRole;

  /** 'active' | 'inactive' | 'deleted' */
  @IsOptional()
  @IsString()
  status?: 'active' | 'inactive' | 'deleted';

  @IsOptional()
  @IsString()
  orgId?: string;

  @IsOptional()
  @IsISO8601()
  createdAtFrom?: string;

  @IsOptional()
  @IsISO8601()
  createdAtTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
