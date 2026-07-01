import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
  ],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
