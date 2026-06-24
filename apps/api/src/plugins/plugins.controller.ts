import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { PluginsService } from './plugins.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IsString, IsArray, IsObject, IsOptional, IsNumber } from 'class-validator';

export class CreatePluginDto {
  @IsString()
  key!: string;

  @IsString()
  name!: string;

  @IsString()
  version!: string;

  @IsString()
  description!: string;

  @IsArray()
  @IsString({ each: true })
  permissions!: string[];

  @IsObject()
  inputSchema!: any;

  @IsObject()
  outputSchema!: any;

  @IsOptional()
  @IsString()
  endpointUrl?: string;

  @IsOptional()
  @IsString()
  scriptCode?: string;

  @IsOptional()
  @IsString()
  authType?: string;

  @IsOptional()
  @IsNumber()
  priceMonthlyCents?: number;

  @IsOptional()
  @IsNumber()
  costPerExecutionCents?: number;
}

export class UpdatePluginDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];

  @IsOptional()
  @IsObject()
  inputSchema?: any;

  @IsOptional()
  @IsObject()
  outputSchema?: any;

  @IsOptional()
  @IsString()
  endpointUrl?: string;

  @IsOptional()
  @IsString()
  scriptCode?: string;

  @IsOptional()
  @IsString()
  authType?: string;

  @IsOptional()
  @IsNumber()
  priceMonthlyCents?: number;

  @IsOptional()
  @IsNumber()
  costPerExecutionCents?: number;

  @IsOptional()
  @IsString()
  isActive?: boolean;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class PluginsController {
  constructor(private readonly pluginsService: PluginsService) {}

  // Marketplace store: List all active plugins
  @Get('api/marketplace/plugins')
  async listAll() {
    return this.pluginsService.findAllActive();
  }

  // Developer endpoint: Register/Publish a new plugin
  @Post('api/marketplace/plugins')
  async create(
    @CurrentUser() user: any,
    @Body() dto: CreatePluginDto,
  ) {
    // Developers can register plugins
    return this.pluginsService.create({
      ...dto,
      authorId: user.id,
    });
  }

  // Get details of a single plugin
  @Get('api/marketplace/plugins/:id')
  async findOne(@Param('id') id: string) {
    return this.pluginsService.findById(id);
  }

  // Developer endpoint: Update a plugin
  @Put('api/marketplace/plugins/:id')
  async update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdatePluginDto,
  ) {
    return this.pluginsService.update(id, user.id, dto);
  }

  // Developer endpoint: Delete/Deactivate a plugin
  @Delete('api/marketplace/plugins/:id')
  async delete(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    await this.pluginsService.delete(id, user.id);
    return { success: true };
  }
}
