import { Controller, Post, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { ToolGeneratorService } from './tool-generator.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IsString } from 'class-validator';

class RequestToolDto {
  @IsString()
  prompt!: string;
}

@Controller('api/tool-generator')
@UseGuards(JwtAuthGuard)
export class ToolGeneratorController {
  constructor(private readonly toolGeneratorService: ToolGeneratorService) {}

  @Post('request')
  async requestTool(
    @CurrentUser() user: any,
    @Body() dto: RequestToolDto,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to any organization');
    }
    return this.toolGeneratorService.generateTool({
      prompt: dto.prompt,
      organizationId: user.organizationId,
    });
  }
}
