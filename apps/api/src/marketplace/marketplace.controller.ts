import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { ListingType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IsString, IsObject, IsOptional, IsNumber, Min, Max } from 'class-validator';

export class InstallPluginDto {
  @IsString()
  pluginId!: string;

  @IsOptional()
  @IsObject()
  config?: any;
}

export class ExecutePluginDto {
  @IsString()
  pluginId!: string;

  @IsObject()
  inputData!: Record<string, any>;

  @IsOptional()
  @IsString()
  conversationId?: string;
}

export class RatePluginDto {
  @IsNumber()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  review?: string;
}

import { RequiresFeature } from "../common/guards/tenant-feature.guard";

@Controller()
@UseGuards(JwtAuthGuard)
@RequiresFeature("marketplace")
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  // Install a plugin to the organization
  @Post('api/plugins/install')
  async install(
    @CurrentUser() user: any,
    @Body() dto: InstallPluginDto,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to any organization');
    }
    return this.marketplaceService.installPlugin({
      organizationId: user.organizationId,
      pluginId: dto.pluginId,
      installedById: user.id,
      config: dto.config,
    });
  }

  // Uninstall a plugin from the organization
  @Delete('api/plugins/install/:pluginId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async uninstall(
    @CurrentUser() user: any,
    @Param('pluginId') pluginId: string,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to any organization');
    }
    await this.marketplaceService.uninstallPlugin(user.organizationId, pluginId);
  }

  // Get list of installed plugins for the organization
  @Get('api/plugins/installed')
  async getInstalled(@CurrentUser() user: any) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to any organization');
    }
    return this.marketplaceService.getInstalledPlugins(user.organizationId);
  }

  // Backwards compatible route alias for list
  @Get('api/plugins/list')
  async getInstalledList(@CurrentUser() user: any) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to any organization');
    }
    return this.marketplaceService.getInstalledPlugins(user.organizationId);
  }

  // Execute a plugin inside the organization environment
  @Post('api/plugins/execute')
  async execute(
    @CurrentUser() user: any,
    @Body() dto: ExecutePluginDto,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to any organization');
    }
    return this.marketplaceService.executeInstalledPlugin({
      organizationId: user.organizationId,
      pluginId: dto.pluginId,
      userId: user.id,
      inputData: dto.inputData,
      conversationId: dto.conversationId,
      userEmail: user.email,
    });
  }

  // Rate/review a plugin in the marketplace
  @Post('api/marketplace/plugins/:pluginId/rate')
  async rate(
    @CurrentUser() user: any,
    @Param('pluginId') pluginId: string,
    @Body() dto: RatePluginDto,
  ) {
    return this.marketplaceService.ratePlugin({
      pluginId,
      userId: user.id,
      rating: dto.rating,
      review: dto.review,
    });
  }

  // ── GET /marketplace ────────────────────────────────────────────────────────

  @Get('marketplace')
  async getMarketplace(
    @Query('type') type?: ListingType,
    @Query('category') category?: string,
    @Query('priceMin') priceMin?: string,
    @Query('priceMax') priceMax?: string,
    @Query('ratingMin') ratingMin?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 10;
    const parsedPriceMin = priceMin ? parseInt(priceMin, 10) : undefined;
    const parsedPriceMax = priceMax ? parseInt(priceMax, 10) : undefined;
    const parsedRatingMin = ratingMin ? parseFloat(ratingMin) : undefined;

    return this.marketplaceService.getListings(
      {
        type,
        category,
        priceMin: parsedPriceMin,
        priceMax: parsedPriceMax,
        ratingMin: parsedRatingMin,
      },
      {
        limit: parsedLimit,
        cursor,
      },
    );
  }

  // ── GET /marketplace/search?q= ──────────────────────────────────────────────

  @Get('marketplace/search')
  async searchMarketplace(@Query('q') q?: string) {
    if (!q) {
      return [];
    }
    return this.marketplaceService.searchListings(q);
  }

  // ── GET /marketplace/creator/stats ──────────────────────────────────────────

  @Get('marketplace/creator/stats')
  async getStats(@CurrentUser() user: any) {
    return this.marketplaceService.getCreatorStats(user.id);
  }

  // ── GET /marketplace/creator/payouts ────────────────────────────────────────

  @Get('marketplace/creator/payouts')
  async getPayouts(@CurrentUser() user: any) {
    return this.marketplaceService.getCreatorPayouts(user.id);
  }

  // ── GET /marketplace/purchases ──────────────────────────────────────────────

  @Get('marketplace/purchases')
  async getPurchases(@CurrentUser() user: any) {
    return this.marketplaceService.getPurchases(user.id);
  }
}

