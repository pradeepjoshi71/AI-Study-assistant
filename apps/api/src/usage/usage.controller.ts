import { Controller, Get, Query, UseGuards, Param } from '@nestjs/common';
import { UsageService } from './usage.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('usage')
@UseGuards(JwtAuthGuard)
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  async getOrgUsage(
    @CurrentUser() user: any,
    @Query('days') days: number = 30,
  ) {
    return this.usage.getOrganizationUsage(user.organizationId, +days);
  }

  @Get('me')
  async getMyUsage(
    @CurrentUser() user: any,
    @Query('days') days: number = 7,
  ) {
    return this.usage.getUserUsage(user.organizationId, user.id, +days);
  }
}
