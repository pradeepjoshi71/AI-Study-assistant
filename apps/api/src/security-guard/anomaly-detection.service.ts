import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AnomalyDetectionService {
  private readonly logger = new Logger(AnomalyDetectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Validates active session context. Checks for session hijack signatures,
   * concurrent sessions, and anomalous IP changes.
   */
  async validateSessionActivity(
    userId: string,
    sessionId: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new UnauthorizedException('Session does not exist or has been revoked');
    }

    if (session.expiresAt < new Date()) {
      await this.prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
      throw new UnauthorizedException('Session has expired');
    }

    // 1. IP Shift Detection
    if (session.ipAddress && session.ipAddress !== ipAddress) {
      const timeDeltaMinutes = (Date.now() - session.lastActiveAt.getTime()) / (60 * 1000);

      // If the IP changes and the last active was less than 5 minutes ago, trigger a geographic velocity warning
      if (timeDeltaMinutes < 5) {
        await this.audit.logSecurityEvent({
          userId,
          eventType: 'geo_velocity_anomaly',
          severity: 'WARNING',
          ipAddress,
          userAgent,
          metadata: {
            previousIp: session.ipAddress,
            currentIp: ipAddress,
            timeDeltaMinutes,
          },
        });
      }
    }

    // 2. Concurrent Session Count Check
    const activeSessionsCount = await this.prisma.session.count({
      where: {
        userId,
        expiresAt: { gte: new Date() },
      },
    });

    if (activeSessionsCount > 5) {
      await this.audit.logSecurityEvent({
        userId,
        eventType: 'concurrent_sessions_threshold_exceeded',
        severity: 'WARNING',
        ipAddress,
        userAgent,
        metadata: {
          activeSessionsCount,
        },
      });
    }

    // 3. Update session audit details
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        ipAddress,
        userAgent,
        lastActiveAt: new Date(),
      },
    });
  }

  /**
   * Immediately invalidates and revokes a session
   */
  async revokeSession(sessionId: string, actorId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) return;

    await this.prisma.$transaction([
      this.prisma.session.delete({ where: { id: sessionId } }),
      this.prisma.auditLog.create({
        data: {
          organizationId: null,
          actorId,
          actorType: 'user',
          action: 'session.revoked',
          resourceType: 'session',
          resourceId: sessionId,
        },
      }),
    ]);
  }
}
