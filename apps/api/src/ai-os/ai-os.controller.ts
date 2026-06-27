import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AgentKernelService } from './kernel/agent-kernel.service';
import { ComputeSchedulerService } from './scheduler/compute-scheduler.service';
import { CostRouterService } from './router/cost-router.service';
import { PolicyEngineService } from './policy/policy-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AiTaskStatus } from '@prisma/client';

@Controller('ai-os')
@UseGuards(JwtAuthGuard)
export class AiOsController {
  private readonly logger = new Logger(AiOsController.name);

  constructor(
    private readonly kernelService: AgentKernelService,
    private readonly schedulerService: ComputeSchedulerService,
    private readonly costRouter: CostRouterService,
    private readonly policyEngine: PolicyEngineService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Run a one-off AI compute task (e.g. Chat inference, Embedding, Summarization).
   */
  @Post('execute')
  async executeTask(
    @CurrentUser() user: any,
    @Body() body: { type: string; inputData: { prompt: string; systemPrompt?: string } },
  ) {
    const tenantId = user.organizationId;
    const { type, inputData } = body;

    if (!type || !inputData || !inputData.prompt) {
      throw new BadRequestException('Invalid execution parameters.');
    }

    // 1. Quota & Safety checks
    await this.policyEngine.validateInputSafety(tenantId, inputData.prompt);
    await this.policyEngine.checkComputeQuota(tenantId, type);

    // 2. Log initial task
    const task = await this.prisma.aiTask.create({
      data: {
        tenantId,
        type,
        status: AiTaskStatus.RUNNING,
        inputData: inputData as any,
      },
    });

    const startTime = Date.now();
    try {
      const computeUnit = this.costRouter.routeComputeUnit(type, inputData.prompt.length);

      const response = await this.costRouter.executeLlmCall(
        tenantId,
        task.id,
        inputData.systemPrompt ?? 'You are a helpful assistant.',
        inputData.prompt,
        computeUnit,
      );

      const latencyMs = Date.now() - startTime;

      // Update task status
      const updatedTask = await this.prisma.aiTask.update({
        where: { id: task.id },
        data: {
          status: AiTaskStatus.COMPLETED,
          outputData: { response } as any,
          latencyMs,
        },
      });

      return {
        taskId: updatedTask.id,
        status: updatedTask.status,
        output: response,
        modelUsed: computeUnit.model,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      await this.prisma.aiTask.update({
        where: { id: task.id },
        data: {
          status: AiTaskStatus.FAILED,
          errorLogs: err.message,
          latencyMs,
        },
      });
      throw err;
    }
  }

  /**
   * Execute or manage agent lifecycle actions: START, RUN, PAUSE, STOP.
   */
  @Post('agent/run')
  async runAgentLifecycle(
    @CurrentUser() user: any,
    @Body()
    body: {
      action: 'START' | 'RUN' | 'PAUSE' | 'STOP';
      sessionKey: string;
      taskId?: string;
      agentId?: string;
      systemPrompt?: string;
      prompt?: string;
    },
  ) {
    const tenantId = user.organizationId;
    const { action, sessionKey, taskId, agentId, systemPrompt, prompt } = body;

    if (!action || !sessionKey) {
      throw new BadRequestException('SessionKey and Action are required.');
    }

    switch (action) {
      case 'START':
        if (!agentId || !systemPrompt) {
          throw new BadRequestException('AgentId and SystemPrompt are required to START.');
        }
        return this.kernelService.startAgent(tenantId, agentId, sessionKey, systemPrompt);

      case 'RUN':
        if (!taskId || !prompt) {
          throw new BadRequestException('TaskId and Prompt are required to RUN.');
        }
        return this.kernelService.runAgentStep(tenantId, sessionKey, taskId, prompt);

      case 'PAUSE':
        if (!taskId) {
          throw new BadRequestException('TaskId is required to PAUSE.');
        }
        return this.kernelService.pauseAgent(tenantId, sessionKey, taskId);

      case 'STOP':
        if (!taskId) {
          throw new BadRequestException('TaskId is required to STOP.');
        }
        return this.kernelService.stopAgent(tenantId, sessionKey, taskId);

      default:
        throw new BadRequestException(`Unsupported action: ${action}`);
    }
  }

  /**
   * Add a scheduled job.
   */
  @Post('schedule')
  async scheduleJob(
    @CurrentUser() user: any,
    @Body() body: { cronExpression: string; taskType: string; params?: any },
  ) {
    const tenantId = user.organizationId;
    const { cronExpression, taskType, params } = body;

    if (!cronExpression || !taskType) {
      throw new BadRequestException('CronExpression and TaskType are required.');
    }

    return this.schedulerService.scheduleJob(tenantId, cronExpression, taskType, params);
  }

  /**
   * Get active schedules.
   */
  @Get('schedules')
  async listSchedules(@CurrentUser() user: any) {
    return this.schedulerService.listSchedules(user.organizationId);
  }

  /**
   * Remove schedule.
   */
  @Delete('schedule/:id')
  async removeSchedule(@CurrentUser() user: any, @Param('id') id: string) {
    await this.schedulerService.unscheduleJob(user.organizationId, id);
    return { success: true };
  }

  /**
   * Retrieve OS telemetry and dashboard stats.
   */
  @Get('status')
  async getStatus(@CurrentUser() user: any) {
    const tenantId = user.organizationId;

    // 1. Fetch system process stats
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    // 2. Fetch AI tasks logs and metrics for this tenant
    const totalTasksCount = await this.prisma.aiTask.count({ where: { tenantId } });
    
    const tasksByStatus = await this.prisma.aiTask.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { id: true },
    });

    const computeLogsSummary = await this.prisma.aiTask.aggregate({
      where: { tenantId },
      _sum: { costCents: true },
      _avg: { latencyMs: true },
    });

    // 3. Check queues status
    let queuesBacklog = 0;
    try {
      const redisClient = this.redis.getClient();
      // Count total wait/active jobs in Bull keys
      const keys = await redisClient.keys('bull:*:wait');
      for (const key of keys) {
        queuesBacklog += await redisClient.llen(key);
      }
    } catch (err: any) {
      this.logger.warn(`Failed to retrieve redis queue backlog: ${err.message}`);
    }

    return {
      status: 'healthy',
      system: {
        memoryPressureBytes: memoryUsage.rss,
        cpuUsageUserMicro: cpuUsage.user,
        nodeVersion: process.version,
      },
      tenantMetrics: {
        totalTasks: totalTasksCount,
        statusCounts: tasksByStatus.map((g) => ({ status: g.status, count: g._count.id })),
        accumulatedCostCents: computeLogsSummary._sum.costCents ?? 0,
        averageLatencyMs: Math.round(computeLogsSummary._avg.latencyMs ?? 0),
        queuesBacklog,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
