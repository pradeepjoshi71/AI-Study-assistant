import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { IsString, IsBoolean } from 'class-validator';

class SetOverrideDto {
  @IsString() organizationId!: string;
  @IsString() key!: string;
  @IsBoolean() enabled!: boolean;
}

@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  @Get('my-flags')
  @UseGuards(JwtAuthGuard)
  getMyFlags(@Req() req: any) {
    const organizationId = req.user.organizationId;
    return this.featureFlagsService.getOrganizationFlags(organizationId);
  }

  @Post('override')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  setOverride(@Body() dto: SetOverrideDto) {
    return this.featureFlagsService.setOverride(dto.organizationId, dto.key, dto.enabled);
  }

  @Delete('override/:orgId/:key')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  removeOverride(
    @Param('orgId') organizationId: string,
    @Param('key') key: string,
  ) {
    return this.featureFlagsService.removeOverride(organizationId, key);
  }
}
