import {
  Controller, Get, Post, Delete, Body, Param, UseGuards, Query,
} from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IsString, IsArray, IsOptional, IsDateString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

class CreateApiKeyDto {
  @IsString() name!: string;
  @IsArray() @IsString({ each: true }) permissions!: string[];
  @IsOptional() @IsNumber() dailyCallLimit?: number;
  @IsOptional() @IsNumber() monthlyTokenLimit?: number;
  @IsOptional() @IsDateString() expiresAt?: string;
}

@Controller('api-keys')
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  list(@CurrentUser() user: any) {
    return this.apiKeys.listKeys(user.organizationId);
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateApiKeyDto) {
    return this.apiKeys.createApiKey({
      organizationId: user.organizationId,
      name: dto.name,
      permissions: dto.permissions,
      dailyCallLimit: dto.dailyCallLimit,
      monthlyTokenLimit: dto.monthlyTokenLimit,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      createdById: user.id,
    });
  }

  @Delete(':id')
  revoke(@CurrentUser() user: any, @Param('id') id: string) {
    return this.apiKeys.revokeKey(id, user.organizationId);
  }

  @Get(':id/stats')
  stats(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('days') days: number = 7,
  ) {
    return this.apiKeys.getKeyUsageStats(id, user.organizationId, +days);
  }
}
