import { Module } from '@nestjs/common';
import { ToolGeneratorService } from './tool-generator.service';
import { ToolGeneratorController } from './tool-generator.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [ToolGeneratorService],
  controllers: [ToolGeneratorController],
  exports: [ToolGeneratorService],
})
export class ToolGeneratorModule {}
