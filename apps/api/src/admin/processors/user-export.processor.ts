import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

export interface UserExportJobData {
  adminId: string;
  filters: Record<string, unknown>;
}

@Injectable()
@Processor('admin-user-export')
export class UserExportProcessor extends WorkerHost {
  private readonly logger = new Logger(UserExportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<UserExportJobData>): Promise<{ signedUrl: string }> {
    const { adminId, filters } = job.data;
    this.logger.log(`[UserExport] job=${job.id} adminId=${adminId}`);

    // -- 1. Fetch all matching users (no pagination for CSV) ------------------
    const where = this.buildWhere(filters);
    const users = await this.prisma.user.findMany({
      where,
      include: {
        organizationMemberships: {
          include: { organization: true },
        },
        subscriptions: {
          include: { plan: true },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // -- 2. Build CSV ----------------------------------------------------------
    const header = [
      'id', 'email', 'name', 'role', 'systemRole',
      'subscriptionPlan', 'isActive', 'orgId', 'orgName',
      'subscriptionStatus', 'createdAt',
    ].join(',');

    const rows = users.map((u) => {
      const membership = u.organizationMemberships[0];
      const sub = u.subscriptions[0];
      return [
        u.id,
        // Anonymize deleted accounts
        u.deletedAt ? `[deleted]` : u.email,
        u.name ?? '',
        u.role,
        u.systemRole,
        u.subscriptionPlan,
        u.isActive,
        membership?.orgId ?? '',
        membership?.organization?.name ?? '',
        sub?.status ?? '',
        u.createdAt.toISOString(),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',');
    });

    const csv = [header, ...rows].join('\n');
    const buffer = Buffer.from(csv, 'utf-8');

    // -- 3. Upload to Minio ----------------------------------------------------
    const exportKey = `admin-exports/users/${adminId}/${Date.now()}.csv`;
    const fakeFile = {
      buffer,
      originalname: 'users-export.csv',
      mimetype: 'text/csv',
      size: buffer.byteLength,
    } as Express.Multer.File;

    // Use the raw S3 upload path; buildKey not relevant here — upload directly
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = (this.storage as any).client;
    const bucket = (this.storage as any).bucket;

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: exportKey,
        Body: buffer,
        ContentType: 'text/csv',
        ContentLength: buffer.byteLength,
      }),
    );

    // -- 4. Return signed URL (1 hour) -----------------------------------------
    const signedUrl = await this.storage.getSignedUrl(exportKey, 3600);
    this.logger.log(`[UserExport] done job=${job.id} url=${signedUrl}`);
    return { signedUrl };
  }

  private buildWhere(filters: Record<string, unknown>) {
    const where: any = {};
    if (filters.plan) where.subscriptionPlan = filters.plan;
    if (filters.systemRole) where.systemRole = filters.systemRole;
    if (filters.orgId) {
      where.organizationMemberships = { some: { orgId: filters.orgId } };
    }
    if (filters.status === 'active') { where.isActive = true; where.deletedAt = null; }
    if (filters.status === 'inactive') { where.isActive = false; where.deletedAt = null; }
    if (filters.status === 'deleted') { where.deletedAt = { not: null }; }
    if (filters.createdAtFrom || filters.createdAtTo) {
      where.createdAt = {};
      if (filters.createdAtFrom) where.createdAt.gte = new Date(filters.createdAtFrom as string);
      if (filters.createdAtTo) where.createdAt.lte = new Date(filters.createdAtTo as string);
    }
    return where;
  }
}
