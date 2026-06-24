import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { PromptOptimizerService } from './prompt-optimizer.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IsString, IsNumber, IsOptional } from 'class-validator';

class CreatePromptDto {
  @IsString()
  mode!: string;

  @IsString()
  systemPrompt!: string;

  @IsOptional()
  @IsNumber()
  accuracyScore?: number;
}

class ActivatePromptDto {
  @IsString()
  mode!: string;

  @IsNumber()
  version!: number;
}

@Controller('api/prompt-optimizer')
@UseGuards(JwtAuthGuard)
export class PromptOptimizerController {
  constructor(private readonly promptOptimizerService: PromptOptimizerService) {}

  @Get('versions')
  async list(@Query('mode') mode?: string) {
    return this.promptOptimizerService.listVersions(mode);
  }

  @Post('create')
  async create(
    @CurrentUser() user: any,
    @Body() dto: CreatePromptDto,
  ) {
    return this.promptOptimizerService.createNewVersion({
      ...dto,
      createdById: user.id,
    });
  }

  @Post('activate')
  async activate(@Body() dto: ActivatePromptDto) {
    return this.promptOptimizerService.activateVersion(dto.mode, dto.version);
  }

  @Post('rollback/:mode')
  async rollback(@Param('mode') mode: string) {
    return this.promptOptimizerService.rollback(mode);
  }
}
