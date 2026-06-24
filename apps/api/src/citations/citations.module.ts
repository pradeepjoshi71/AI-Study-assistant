import { Module } from '@nestjs/common';
import { CitationsService } from './citations.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [CitationsService],
  exports: [CitationsService],
})
export class CitationsModule {}
