import { IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { Platform } from "@prisma/client";

export class MobileLoginDto {
  @IsString()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsString()
  @IsNotEmpty()
  deviceId!: string;

  @IsEnum(Platform)
  @IsNotEmpty()
  platform!: Platform;

  @IsString()
  @IsOptional()
  fcmToken?: string;
}

export class MobileRefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;

  @IsString()
  @IsNotEmpty()
  deviceId!: string;
}
