import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';
import { StudyGroupController } from './study-group.controller';
import { StudyGroupService } from './study-group.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    AuthModule,
    BullModule.registerQueue(
      { name: 'org-notifications' },
      { name: 'group-document-sync' },
      { name: 'group-session-summary' },
    ),
  ],

  controllers: [StudyGroupController],
  providers: [StudyGroupService],
  exports: [StudyGroupService],
})
export class StudyGroupModule {}
