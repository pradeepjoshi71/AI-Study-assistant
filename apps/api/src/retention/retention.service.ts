import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ConfigService } from '@nestjs/config';
import { auditLogsArchivedCounter } from '../platform/metrics/prometheus.controller';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { createHash } from 'crypto';

const gzipAsync = promisify(zlib.gzip);

@Injectable()
export class RetentionService implements OnModuleInit {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    this.logger.log('Bootstrapping RetentionService compliance settings...');
    await this.storage.configureCompliance();
  }

  // Daily cron at 2:00 AM UTC
  @Cron('0 2 * * *', { timeZone: 'UTC' })
  async handleRetentionCron() {
    this.logger.log('Starting daily audit log retention & archiving cron job...');

    try {
      // Fetch custom retention policies per organization
      const policies = await this.prisma.retentionPolicy.findMany();

      for (const policy of policies) {
        await this.archiveOrgAuditLogs(policy.orgId, policy.auditRetentionDays);
      }

      this.logger.log('Audit log retention cron job finished.');
    } catch (err: any) {
      this.logger.error(`Error during retention cron run: ${err.message}`);
      await this.sendSlackAlert('system', `Daily retention cron job failed: ${err.message}`);
    }
  }

  private async archiveOrgAuditLogs(orgId: string, retentionDays: number) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    this.logger.log(`Processing retention for orgId: ${orgId}, cutoff: ${cutoffDate.toISOString()}`);

    const limit = 1000;
    let archivedCount = 0;

    while (true) {
      // Query up to 1000 matching AuditLog records
      const logs = await this.prisma.auditLog.findMany({
        where: {
          orgId: orgId,
          createdAt: { lt: cutoffDate },
        },
        take: limit,
        orderBy: { createdAt: 'asc' },
      });

      if (logs.length === 0) {
        break;
      }

      try {
        // 1. Serialize to JSONL
        const jsonl = logs.map(log => JSON.stringify(log)).join('\n') + '\n';
        const buffer = Buffer.from(jsonl, 'utf-8');

        // 2. Compress to gzip
        const compressed = await gzipAsync(buffer);

        // 3. Generate SHA256 of gzipped file
        const sha256 = createHash('sha256').update(compressed).digest('hex');

        // 4. Construct S3 storage key
        const now = new Date();
        const year = now.getUTCFullYear();
        const month = String(now.getUTCMonth() + 1).padStart(2, '0');
        const timestamp = now.getTime();
        const storageKey = `audits/${orgId}/${year}/${month}-${timestamp}.jsonl.gz`;

        // 5. Upload buffer to Minio
        await this.storage.uploadBuffer(storageKey, compressed, 'application/gzip');

        // 6. Verify upload success via HeadObject (check length matches exactly)
        const headInfo = await this.storage.head(storageKey);
        if (!headInfo || headInfo.contentLength !== compressed.length) {
          throw new Error(`Upload verification failed for key: ${storageKey}. Expected length: ${compressed.length}, found: ${headInfo?.contentLength ?? 'none'}`);
        }

        // 7. Store SHA256 in DB
        await this.prisma.auditArchive.create({
          data: {
            orgId: orgId,
            storageKey: storageKey,
            sha256: sha256,
          },
        });

        // 8. Delete archived records from live database
        const logIds = logs.map(l => l.id);
        await this.prisma.auditLog.deleteMany({
          where: { id: { in: logIds } },
        });

        // 9. Increment Prometheus Counter
        auditLogsArchivedCounter.inc({ orgId }, logs.length);
        archivedCount += logs.length;

        this.logger.log(`Archived and deleted ${logs.length} audit logs for orgId: ${orgId} to ${storageKey}`);
      } catch (err: any) {
        this.logger.error(`Failed archiving batch for orgId: ${orgId}: ${err.message}`);
        await this.sendSlackAlert(orgId, `Batch archiving failed: ${err.message}. Deletion skipped.`);
        break; // Stop loop on failure to prevent data loss or duplicate uploads
      }
    }

    if (archivedCount > 0) {
      this.logger.log(`Retention completed for orgId: ${orgId}. Total archived: ${archivedCount}`);
    }
  }

  private async sendSlackAlert(orgId: string, message: string) {
    const slackUrl = this.config.get<string>('SLACK_WEBHOOK_URL') || process.env.SLACK_WEBHOOK_URL;
    if (!slackUrl) {
      this.logger.warn('SLACK_WEBHOOK_URL is not configured. Alert skipped.');
      return;
    }

    try {
      const response = await fetch(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🚨 *Audit Retention Alert* 🚨\n*Organization*: ${orgId}\n*Details*: ${message}\n*Time*: ${new Date().toISOString()}`,
        }),
      });

      if (response.status !== 200) {
        this.logger.error(`Slack webhook returned status ${response.status}`);
      }
    } catch (err: any) {
      this.logger.error(`Failed to send alert webhook to Slack: ${err.message}`);
    }
  }
}
