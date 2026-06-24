import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { AiTaskStatus } from '@prisma/client';

@Injectable()
export class ComputeSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ComputeSchedulerService.name);
  private tickInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('graph-building') private readonly graphQueue: Queue,
    @InjectQueue('memory-summarization') private readonly memoryQueue: Queue,
    @InjectQueue('analytics-aggregation') private readonly analyticsQueue: Queue,
    @InjectQueue('cost-aggregation') private readonly costQueue: Queue,
  ) {}

  onApplicationBootstrap() {
    this.logger.log('Initializing AI OS Compute Scheduler Loop...');
    // Tick every 15 seconds to check for due jobs
    this.tickInterval = setInterval(() => {
      this.triggerDueJobs().catch((err) => {
        this.logger.error(`Error in scheduler tick: ${err.message}`);
      });
    }, 15000);
  }

  onModuleDestroy() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  /**
   * Add a cron-like schedule to the database.
   */
  async scheduleJob(
    tenantId: string,
    cronExpression: string,
    taskType: string,
    params?: any,
  ): Promise<any> {
    const nextRun = this.calculateNextRun(cronExpression, new Date());
    this.logger.log(
      `Scheduling task of type '${taskType}' for tenant=${tenantId} using cron='${cronExpression}'. Next run: ${nextRun}`,
    );

    return this.prisma.aiSchedule.create({
      data: {
        tenantId,
        cronExpression,
        taskType,
        params: params ?? {},
        nextRun,
        isActive: true,
      },
    });
  }

  /**
   * Deactivate or delete a schedule.
   */
  async unscheduleJob(tenantId: string, id: string): Promise<void> {
    this.logger.log(`Removing schedule: ${id} for tenant=${tenantId}`);
    await this.prisma.aiSchedule.delete({
      where: { id, tenantId },
    });
  }

  /**
   * List schedules for a tenant.
   */
  async listSchedules(tenantId: string): Promise<any[]> {
    return this.prisma.aiSchedule.findMany({
      where: { tenantId },
      orderBy: { nextRun: 'asc' },
    });
  }

  /**
   * Check the database for due jobs and dispatch them.
   */
  async triggerDueJobs(): Promise<void> {
    const now = new Date();
    
    // Find all active schedules where nextRun is in the past
    const dueSchedules = await this.prisma.aiSchedule.findMany({
      where: {
        isActive: true,
        nextRun: { lte: now },
      },
    });

    if (dueSchedules.length === 0) return;

    this.logger.log(`Found ${dueSchedules.length} due AI schedules. Dispatching...`);

    for (const schedule of dueSchedules) {
      try {
        // 1. Create a corresponding AiTask to monitor task lifecycle
        const task = await this.prisma.aiTask.create({
          data: {
            tenantId: schedule.tenantId,
            type: schedule.taskType,
            status: AiTaskStatus.QUEUED,
            inputData: { scheduleId: schedule.id, params: schedule.params },
          },
        });

        // 2. Dispatch to the correct BullMQ Queue
        const jobData = {
          tenantId: schedule.tenantId,
          taskId: task.id,
          ...(schedule.params as object),
        };

        switch (schedule.taskType) {
          case 'graph_update':
          case 'graph-building':
            await this.graphQueue.add('build-graph', jobData);
            break;
          case 'memory_summarization':
            await this.memoryQueue.add('summarize-memory', jobData);
            break;
          case 'analytics_aggregation':
            await this.analyticsQueue.add('aggregate-analytics', jobData);
            break;
          case 'cost_aggregation':
            await this.costQueue.add('aggregate-costs', jobData);
            break;
          default:
            this.logger.warn(`Unknown schedule taskType: ${schedule.taskType}`);
            await this.prisma.aiTask.update({
              where: { id: task.id },
              data: { status: AiTaskStatus.FAILED, errorLogs: `Unknown taskType: ${schedule.taskType}` },
            });
            break;
        }

        // 3. Update the schedule nextRun time
        const nextRun = this.calculateNextRun(schedule.cronExpression, now);
        await this.prisma.aiSchedule.update({
          where: { id: schedule.id },
          data: {
            nextRun,
            updatedAt: now,
          },
        });

        this.logger.log(`Dispatched schedule ${schedule.id} of type ${schedule.taskType}. Next run is ${nextRun}`);
      } catch (err: any) {
        this.logger.error(`Failed to dispatch schedule ${schedule.id}: ${err.message}`);
      }
    }
  }

  /**
   * Helper to parse cron expressions and compute next execution datetime.
   * Supports: hourly, nightly (2am), weekly (Sunday 12am), or defaults to +24 hours.
   */
  private calculateNextRun(cronExpression: string, relativeTo: Date): Date {
    const date = new Date(relativeTo.getTime());

    if (cronExpression === '0 * * * *' || cronExpression.includes('hourly')) {
      // Hourly: set minutes, seconds to 0, add 1 hour
      date.setUTCHours(date.getUTCHours() + 1);
      date.setUTCMinutes(0, 0, 0);
    } else if (cronExpression === '0 2 * * *' || cronExpression.includes('nightly')) {
      // Nightly at 2am
      date.setUTCDate(date.getUTCDate() + 1);
      date.setUTCHours(2, 0, 0, 0);
    } else if (cronExpression === '0 0 * * 0' || cronExpression.includes('weekly')) {
      // Weekly: next Sunday at midnight
      const dayOffset = (7 - date.getUTCDay()) % 7 || 7;
      date.setUTCDate(date.getUTCDate() + dayOffset);
      date.setUTCHours(0, 0, 0, 0);
    } else {
      // Custom/Default: Add 24 hours
      date.setTime(date.getTime() + 24 * 60 * 60 * 1000);
    }

    return date;
  }
}
