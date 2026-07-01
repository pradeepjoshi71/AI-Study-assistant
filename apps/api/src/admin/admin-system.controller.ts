import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  UseInterceptors,
} from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { IsString, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { AdminGuard } from './guards/admin.guard';
import { SuperAdmin } from './decorators/super-admin.decorator';
import { AdminSystemService } from './admin-system.service';
import { AuditInterceptor } from '../audit/interceptors/audit.interceptor';

class CreateConfigDto {
  @IsString() key!: string;
  @IsString() value!: string;
  @IsOptional() @IsString() description?: string;
}

class UpdateConfigDto {
  @IsString() value!: string;
}

@Controller('admin/system')
@UseGuards(JwtAuthGuard, AdminGuard, ThrottlerGuard)
@Throttle({ admin: { limit: 30, ttl: 60000 } })
@UseInterceptors(AuditInterceptor)
export class AdminSystemController {
  constructor(private readonly systemService: AdminSystemService) {}

  // -- GET /admin/system/health -------------------------------------------------
  @Get('health')
  @SuperAdmin()
  getHealth() {
    return this.systemService.getHealth();
  }

  // -- GET /admin/system/config -------------------------------------------------
  @Get('config')
  @SuperAdmin()
  listConfigs() {
    return this.systemService.listConfigs();
  }

  // -- GET /admin/system/config/:key --------------------------------------------
  @Get('config/:key')
  @SuperAdmin()
  getConfig(@Param('key') key: string) {
    return this.systemService.getConfig(key);
  }

  // -- POST /admin/system/config -------------------------------------------------
  @Post('config')
  @SuperAdmin()
  createConfig(@Body() dto: CreateConfigDto, @Req() req: any) {
    return this.systemService.createConfig(dto, req.user.sub);
  }

  // -- PATCH /admin/system/config/:key ------------------------------------------
  @Patch('config/:key')
  @SuperAdmin()
  updateConfig(
    @Param('key') key: string,
    @Body() dto: UpdateConfigDto,
    @Req() req: any,
  ) {
    return this.systemService.updateConfig(key, dto.value, req.user.sub);
  }

  // -- DELETE /admin/system/config/:key -----------------------------------------
  @Delete('config/:key')
  @SuperAdmin()
  @HttpCode(HttpStatus.OK)
  deleteConfig(@Param('key') key: string) {
    return this.systemService.deleteConfig(key);
  }
}
