import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  UseFilters,
  HttpCode,
  HttpStatus,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../api-key/guards/api-key.guard';
import { ApiKeyCtx, ApiKeyContext } from '../../api-key/decorators/api-key-context.decorator';
import { Scopes } from '../../api-key/decorators/scopes.decorator';
import { WebhooksService } from '../../webhooks/webhooks.service';
import { envelope } from '../common/envelope';
import { PublicApiExceptionFilter } from '../common/public-api-exception.filter';
import { IsString, IsArray, IsUrl, IsNotEmpty } from 'class-validator';

class CreateWebhookDto {
  @IsNotEmpty()
  @IsUrl()
  url!: string;

  @IsArray()
  @IsString({ each: true })
  events!: string[];
}

import { RequiresFeature } from "../../common/guards/tenant-feature.guard";

@ApiTags('Public Webhooks')
@ApiBearerAuth('bearer')
@UseGuards(ApiKeyGuard)
@UseFilters(PublicApiExceptionFilter)
@Controller({ path: 'api/public/v1/webhooks', version: VERSION_NEUTRAL })
@RequiresFeature("api_access")
export class PublicWebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * POST /api/public/v1/webhooks
   * Registers a new outbound webhook endpoint for the organization.
   * HMAC secret is automatically generated and returned exactly once.
   * Scopes: webhooks:write
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Scopes('webhooks:write')
  @ApiOperation({ summary: 'Register webhook endpoint', description: 'Create a new outbound webhook endpoint to receive organization event notifications. The generated HMAC signature secret is returned exactly once in the response.' })
  @ApiResponse({ status: 201, description: 'Webhook endpoint registered and HMAC secret generated successfully.' })

  async create(
    @Req() req: Request,
    @Body() dto: CreateWebhookDto,
    @ApiKeyCtx() ctx: ApiKeyContext,
  ) {
    const result = await this.webhooksService.createEndpoint(
      ctx.orgId,
      dto.url,
      dto.events,
    );

    return envelope(result, req);
  }
}
