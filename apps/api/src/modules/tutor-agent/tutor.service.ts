import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { GeneratePlanDto, CompleteTaskDto } from './tutor.types';

@Injectable()
export class TutorService {
  private readonly logger = new Logger(TutorService.name);
  private readonly aiServiceUrl: string;

  constructor(
    private prisma: PrismaService,
    private analyticsService: AnalyticsService,
    private configService: ConfigService,
  ) {
    this.aiServiceUrl = this.configService.get<string>(
      'NEXT_PUBLIC_AI_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  /**
   * Generates a new 7-day study plan based on user topic mastery.
   * Archives any existing active study plans, calls FastAPI, and saves the new plan.
   */
  async generateWeeklyPlan(userId: string, tenantId: string, dto: GeneratePlanDto) {
    const { timeAvailability } = dto;

    // 1. Archive current active plans
    await this.prisma.studyPlan.updateMany({
      where: {
        userId,
        tenantId,
        status: 'ACTIVE',
      },
      data: {
        status: 'ARCHIVED',
      },
    });

    // 2. Fetch user topic mastery summary from AnalyticsService
    const summary = await this.analyticsService.getDashboardSummary(userId, tenantId);

    // 3. Post to FastAPI AI tutor generation endpoint
    const url = `${this.aiServiceUrl}/ai/tutor/plan/generate`;
    this.logger.log(`Calling FastAPI tutor planner at: ${url}`);

    let plannerOutput: any = null;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          timeAvailability,
          masteryScores: summary.topicMastery,
        }),
      });

      if (!response.ok) {
        throw new Error(`FastAPI response failed: ${response.statusText}`);
      }

      plannerOutput = await response.json();
    } catch (err: any) {
      this.logger.error(`Failed to generate tutor plan via AI service: ${err.message}`);
      throw new BadRequestException(`AI Tutor service is currently unavailable: ${err.message}`);
    }

    if (!plannerOutput || !plannerOutput.schedule) {
      throw new BadRequestException('AI service did not return a valid study schedule.');
    }

    // 4. Create the StudyPlan in PostgreSQL
    const weekStart = new Date();
    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() + 7);

    const plan = await this.prisma.studyPlan.create({
      data: {
        userId,
        tenantId,
        weekStart,
        weekEnd,
        status: 'ACTIVE',
      },
    });

    // 5. Create the individual StudyTasks
    const taskPromises = [];
    for (const daySchedule of plannerOutput.schedule) {
      const day = daySchedule.day;
      for (const taskItem of daySchedule.tasks) {
        taskPromises.push(
          this.prisma.studyTask.create({
            data: {
              planId: plan.id,
              day,
              type: taskItem.type,
              status: 'PENDING',
              metadata: {
                topic: taskItem.metadata?.topic || 'General',
                description: taskItem.metadata?.description || 'Study session',
                estimatedTime: taskItem.estimatedTime || 30,
              },
            },
          }),
        );
      }
    }
    await Promise.all(taskPromises);

    // 6. Delete old insights and save new AI tutor insights
    await this.prisma.tutorInsight.deleteMany({
      where: { userId, tenantId },
    });

    const insightPromises = (plannerOutput.insights || []).map((ins: any) =>
      this.prisma.tutorInsight.create({
        data: {
          userId,
          tenantId,
          insightText: ins.insightText,
          priorityLevel: ins.priorityLevel || 'MEDIUM',
        },
      }),
    );
    await Promise.all(insightPromises);

    // Return the active plan with tasks
    return this.prisma.studyPlan.findUnique({
      where: { id: plan.id },
      include: {
        tasks: true,
      },
    });
  }

  /**
   * Fetches the current active study plan for a user.
   */
  async getCurrentPlan(userId: string, tenantId: string) {
    const plan = await this.prisma.studyPlan.findFirst({
      where: {
        userId,
        tenantId,
        status: 'ACTIVE',
      },
      include: {
        tasks: {
          orderBy: { day: 'asc' },
        },
      },
    });

    if (!plan) {
      throw new NotFoundException('No active study plan found. Generate one to start studying.');
    }

    return plan;
  }

  /**
   * Marks a study task as completed and applies dynamic plan adaptations if the student struggles.
   */
  async completeTask(userId: string, tenantId: string, taskId: string, dto: CompleteTaskDto) {
    const task = await this.prisma.studyTask.findUnique({
      where: { id: taskId },
      include: { plan: true },
    });

    if (!task) {
      throw new NotFoundException('Study task not found');
    }

    if (task.plan.tenantId !== tenantId) {
      throw new ForbiddenException('Tenant access denied');
    }

    // 1. Mark task completed
    const updatedTask = await this.prisma.studyTask.update({
      where: { id: taskId },
      data: { status: 'COMPLETED' },
    });

    // 2. Dynamic adaptation: if score is low (<60) or failed, schedule a revision session on the next day
    if (dto.score !== undefined && dto.score < 60) {
      const taskMeta = task.metadata as any;
      const topic = taskMeta?.topic || 'General';
      const nextDay = Math.min(task.day + 1, 7);

      this.logger.log(`Quiz task score low (${dto.score}%). Adapting plan to add revision for topic "${topic}" on Day ${nextDay}.`);

      await this.prisma.studyTask.create({
        data: {
          planId: task.planId,
          day: nextDay,
          type: 'REVISION',
          status: 'PENDING',
          metadata: {
            topic,
            description: `AI Revision: Re-evaluate weak topic "${topic}" (struggled in quiz: ${dto.score}%)`,
            estimatedTime: 20,
          },
        },
      });
    }

    return updatedTask;
  }

  /**
   * Retrieves active AI tutor coaching recommendations.
   */
  async getRecommendations(userId: string, tenantId: string) {
    return this.prisma.tutorInsight.findMany({
      where: { userId, tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
