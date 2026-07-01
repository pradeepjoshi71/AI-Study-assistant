import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { IsBoolean, IsInt, IsOptional, IsArray, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { AdminGuard } from './guards/admin.guard';
import { SuperAdmin } from './decorators/super-admin.decorator';
import { AdminFlagsService } from './admin-flags.service';
import { AuditInterceptor } from '../audit/interceptors/audit.interceptor';

class UpdateFlagDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPercent?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetOrgIds?: string[];
}

@Controller('admin/flags')
@UseGuards(JwtAuthGuard, AdminGuard, ThrottlerGuard)
@Throttle({ admin: { limit: 30, ttl: 60000 } })
@UseInterceptors(AuditInterceptor)
export class AdminFlagsController {
  constructor(private readonly flagsService: AdminFlagsService) {}

  // -- GET /admin/flags ---------------------------------------------------------
  @Get()
  @SuperAdmin()
  getAllFlags() {
    return this.flagsService.getAllFlags();
  }

  // -- PATCH /admin/flags/:key --------------------------------------------------
  @Patch(':key')
  @SuperAdmin()
  updateFlag(@Param('key') key: string, @Body() dto: UpdateFlagDto) {
    return this.flagsService.updateFlag(key, dto);
  }
}
