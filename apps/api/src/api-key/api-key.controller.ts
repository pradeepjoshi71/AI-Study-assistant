import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiKeyService, CreateApiKeyParams } from './api-key.service';

class CreateApiKeyDto {
  name!: string;
  scopes!: string[];
  permissions?: string[];
  dailyCallLimit?: number;
  monthlyTokenLimit?: number;
  expiresAt?: string; // ISO date string
}

@UseGuards(JwtAuthGuard)
@Controller('api-keys')
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  /** POST /api-keys — create a new key (full key shown once). */
  @Post()
  async create(
    @CurrentUser() user: { id: string; organizationId?: string },
    @Body() dto: CreateApiKeyDto,
  ) {
    const orgId = user.organizationId;
    if (!orgId) {
      return { error: 'User must belong to an organization to create API keys.' };
    }

    const params: CreateApiKeyParams = {
      organizationId: orgId,
      userId: user.id,
      name: dto.name,
      scopes: dto.scopes ?? [],
      permissions: dto.permissions,
      dailyCallLimit: dto.dailyCallLimit,
      monthlyTokenLimit: dto.monthlyTokenLimit,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    };

    return this.apiKeyService.createKey(params);
  }

  /** GET /api-keys — list all non-revoked keys for the org. */
  @Get()
  async list(@CurrentUser() user: { id: string; organizationId?: string }) {
    return this.apiKeyService.listKeys(user.organizationId!);
  }

  /** GET /api-keys/:id — get a single key. */
  @Get(':id')
  async getOne(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; organizationId?: string },
  ) {
    return this.apiKeyService.getKey(id, user.organizationId!);
  }

  /** GET /api-keys/:id/usage?days=7 — usage stats. */
  @Get(':id/usage')
  async usage(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; organizationId?: string },
    @Query('days', new DefaultValuePipe(7), ParseIntPipe) days: number,
  ) {
    return this.apiKeyService.getUsageStats(id, user.organizationId!, days);
  }

  /** DELETE /api-keys/:id — revoke a key immediately. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; organizationId?: string },
  ) {
    return this.apiKeyService.revokeKey(id, user.organizationId!);
  }
}
