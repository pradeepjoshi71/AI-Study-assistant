import { Module } from '@nestjs/common';
import { AutonomousAgentService } from './autonomous-agent.service';
import { AutonomousAgentController } from './autonomous-agent.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PromptOptimizerModule } from '../prompt-optimizer/prompt-optimizer.module';

@Module({
  imports: [PrismaModule, PromptOptimizerModule],
  providers: [AutonomousAgentService],
  controllers: [AutonomousAgentController],
  exports: [AutonomousAgentService],
})
export class AutonomousAgentModule {}
