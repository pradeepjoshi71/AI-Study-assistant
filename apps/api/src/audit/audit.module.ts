import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditProcessor } from './processors/audit.processor';
import { AuditInterceptor } from './interceptors/audit.interceptor';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({ name: 'audit' }),
  ],
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditProcessor,
    AuditInterceptor,
  ],
  exports: [
    AuditService,
    AuditInterceptor,
  ],
})
export class AuditModule {}
