import { Module } from '@nestjs/common';
import { UsageService } from './usage.service';
import { UsageController } from './usage.controller';
import { UsageBufferService } from './usage-buffer.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [UsageController],
  providers: [UsageService, UsageBufferService],
  exports: [UsageService, UsageBufferService],
})
export class UsageModule {}
