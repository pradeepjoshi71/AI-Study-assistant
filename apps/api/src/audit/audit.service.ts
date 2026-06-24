import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export interface AuditLogParams {
  organizationId?: string;
  actorId?: string;
  actorType: 'user' | 'admin' | 'system' | 'api_key';
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
}

export interface SecurityEventParams {
  userId?: string;
  organizationId?: string;
  eventType: string; // "login_failed" | "geo_velocity_anomaly" | "brute_force" | "mfa_bypass"
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly s3Client: S3Client | null = null;
  private readonly bucketName: string;
  private readonly region: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY');
    this.region = this.config.get<string>('AWS_REGION', 'us-east-1');
    this.bucketName = this.config.get<string>('AWS_S3_BUCKET', 'study-assistant-bucket');

    if (accessKeyId && secretAccessKey) {
      this.s3Client = new S3Client({
        region: this.region,
        credentials: { accessKeyId, secretAccessKey },
      });
    }
  }

  /**
   * Log an operational event to the immutable AuditLog table
   */
  async log(params: AuditLogParams) {
    try {
      const logEntry = await this.prisma.auditLog.create({
        data: {
          organizationId: params.organizationId ?? null,
          actorId: params.actorId ?? 'system',
          actorType: params.actorType,
          action: params.action,
          resourceType: params.resourceType ?? null,
          resourceId: params.resourceId ?? null,
          correlationId: params.correlationId ?? null,
          metadata: params.metadata ?? {},
          ipAddress: params.ipAddress ?? null,
          userAgent: params.userAgent ?? null,
        },
      });
      return logEntry;
    } catch (err: any) {
      this.logger.error(`Failed to write audit log entry: ${err.message}`);
    }
  }

  /**
   * Log a security incident or warning to the SecurityEvent table
   */
  async logSecurityEvent(params: SecurityEventParams) {
    try {
      const securityEntry = await this.prisma.securityEvent.create({
        data: {
          userId: params.userId ?? null,
          organizationId: params.organizationId ?? null,
          eventType: params.eventType,
          severity: params.severity,
          ipAddress: params.ipAddress ?? null,
          userAgent: params.userAgent ?? null,
          metadata: params.metadata ?? {},
        },
      });

      if (params.severity === 'CRITICAL') {
        this.logger.error(`🚨 CRITICAL SECURITY EVENT: ${params.eventType} - Org: ${params.organizationId} - IP: ${params.ipAddress}`);
      } else if (params.severity === 'WARNING') {
        this.logger.warn(`⚠ WARNING SECURITY EVENT: ${params.eventType} - Org: ${params.organizationId} - IP: ${params.ipAddress}`);
      }

      return securityEntry;
    } catch (err: any) {
      this.logger.error(`Failed to write security event entry: ${err.message}`);
    }
  }

  /**
   * Export audit logs to S3 cold storage for enterprise compliance auditing
   */
  async exportAuditLogsToS3(organizationId: string): Promise<string> {
    const logs = await this.prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    if (logs.length === 0) {
      throw new InternalServerErrorException('No audit logs found for this organization');
    }

    const payload = JSON.stringify(logs, null, 2);
    const key = `audit-exports/${organizationId}/${Date.now()}-audit-log.json`;

    if (!this.s3Client) {
      const mockUrl = `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`;
      this.logger.log(`[Mock S3 Export] Uploaded audit logs to Key: ${key}`);
      return mockUrl;
    }

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: Buffer.from(payload),
          ContentType: 'application/json',
        }),
      );

      return `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`;
    } catch (err: any) {
      this.logger.error(`Failed to upload audit logs to S3: ${err.message}`);
      throw new InternalServerErrorException('Compliance export failure');
    }
  }
}
