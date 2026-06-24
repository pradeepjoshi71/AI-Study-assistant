import { Controller, Get, Post, Body, Param, UseGuards, BadRequestException } from '@nestjs/common';
import { AutonomousAgentService } from './autonomous-agent.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IsString, IsOptional } from 'class-validator';

class RejectActionDto {
  @IsOptional()
  @IsString()
  feedbackMsg?: string;
}

@Controller('api/autonomous')
@UseGuards(JwtAuthGuard)
export class AutonomousAgentController {
  constructor(private readonly autonomousAgentService: AutonomousAgentService) {}

  @Post('agent/trigger')
  async triggerScan(@CurrentUser() user: any) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to an organization');
    }
    const proposal = await this.autonomousAgentService.scanSystemAndOptimize(user.organizationId);
    return {
      success: true,
      message: proposal ? 'Agent proposed new optimizations' : 'System diagnostics healthy. No modifications suggested.',
      proposal,
    };
  }

  @Get('actions')
  async listActions(@CurrentUser() user: any) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to an organization');
    }
    return this.autonomousAgentService.listActions(user.organizationId);
  }

  @Post('actions/:id/approve')
  async approve(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.autonomousAgentService.approveAction(id, user.id);
  }

  @Post('actions/:id/reject')
  async reject(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: RejectActionDto,
  ) {
    return this.autonomousAgentService.rejectAction(id, user.id, dto.feedbackMsg);
  }
}
