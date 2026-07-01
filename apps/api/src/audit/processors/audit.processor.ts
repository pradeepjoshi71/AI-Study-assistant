import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActorType } from '@prisma/client';

export interface AuditJobData {
  orgId?: string;
  userId?: string;
  actorId: string;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata: any;
  ip?: string;
  userAgent?: string;
}

function mapActorType(type: string): ActorType {
  const lower = type.toLowerCase();
  if (lower === 'admin') return ActorType.ADMIN;
  if (lower === 'system' || lower === 'api_key') return ActorType.SYSTEM;
  return ActorType.USER;
}

@Injectable()
@Processor('audit', { concurrency: 10 })
export class AuditProcessor extends WorkerHost {
  private readonly logger = new Logger(AuditProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<AuditJobData>): Promise<void> {
    const data = job.data;
    try {
      await this.prisma.auditLog.create({
        data: {
          orgId: data.orgId ?? null,
          userId: data.userId ?? null,
          actorId: data.actorId || 'system',
          actorType: mapActorType(data.actorType),
          action: data.action,
          resourceType: data.resourceType,
          resourceId: data.resourceId ?? null,
          metadata: data.metadata ?? {},
          ip: data.ip ?? null,
          userAgent: data.userAgent ?? null,
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to execute async audit log job ${job.id}: ${err.message}`);
      throw err;
    }
  }
}
