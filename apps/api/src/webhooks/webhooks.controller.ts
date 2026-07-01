import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { WebhooksService } from './webhooks.service';
import { IsString, IsArray, IsUrl, IsNotEmpty } from 'class-validator';

class CreateWebhookDto {
  @IsNotEmpty()
  @IsUrl()
  url!: string;

  @IsArray()
  @IsString({ each: true })
  events!: string[];
}

@UseGuards(JwtAuthGuard)
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get()
  async list(@CurrentUser() user: { id: string; organizationId?: string }) {
    const orgId = user.organizationId ?? user.id;
    return this.webhooksService.listEndpoints(orgId);
  }

  @Post()
  async create(
    @CurrentUser() user: { id: string; organizationId?: string },
    @Body() dto: CreateWebhookDto,
  ) {
    const orgId = user.organizationId ?? user.id;
    return this.webhooksService.createEndpoint(orgId, dto.url, dto.events);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async delete(
    @CurrentUser() user: { id: string; organizationId?: string },
    @Param('id') id: string,
  ) {
    const orgId = user.organizationId ?? user.id;
    return this.webhooksService.deleteEndpoint(id, orgId);
  }
}
