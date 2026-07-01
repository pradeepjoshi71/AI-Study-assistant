import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminSystemController } from './admin-system.controller';
import { AdminSystemService } from './admin-system.service';
import { AdminFlagsController } from './admin-flags.controller';
import { AdminFlagsService } from './admin-flags.service';
import { AdminComplianceController } from './admin-compliance.controller';
import { UserExportProcessor } from './processors/user-export.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { BillingModule } from '../billing/billing.module';
import { StorageModule } from '../storage/storage.module';
import { AdminAuditInterceptor } from './interceptors/admin-audit.interceptor';

// Queue names needed by AdminSystemService for job-count health checks
const MONITORED_QUEUES = [
  'document-processing',
  'embedding-generation',
  'graph-building',
  'analytics-aggregation',
  'memory-summarization',
  'cost-aggregation',
  'push-notifications',
  'voice-processing',
  'adaptive-mastery',
  'exam-generation',
  'admin-user-export',
  'stripe-sync',
];

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    BillingModule,
    StorageModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET', 'access_secret_12345'),
        signOptions: { expiresIn: '15m' },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: 'admin-user-export' },
      { name: 'stripe-sync' },
      { name: 'compliance' },
      ...MONITORED_QUEUES.map((name) => ({ name })),
    ),
  ],
  controllers: [
    AdminController,
    AdminUsersController,
    AdminSystemController,
    AdminFlagsController,
    AdminComplianceController,
  ],
  providers: [
    AdminService,
    AdminUsersService,
    AdminSystemService,
    AdminFlagsService,
    UserExportProcessor,
    {
      provide: APP_INTERCEPTOR,
      useClass: AdminAuditInterceptor,
    },
  ],
  exports: [AdminService, AdminUsersService, AdminFlagsService],
})
export class AdminModule {}
