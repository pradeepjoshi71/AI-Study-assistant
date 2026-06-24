import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { AnomalyDetectionService } from './anomaly-detection.service';
import { RbacAbacGuard } from './guards/rbac-abac.guard';
import { SecurityHeadersMiddleware } from './middleware/security-headers.middleware';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [AnomalyDetectionService, RbacAbacGuard],
  exports: [AnomalyDetectionService, RbacAbacGuard],
})
export class SecurityGuardModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply security headers middleware globally to all routes
    consumer.apply(SecurityHeadersMiddleware).forRoutes('*');
  }
}
