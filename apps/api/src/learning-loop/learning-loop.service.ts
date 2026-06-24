import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PromptOptimizerService } from '../prompt-optimizer/prompt-optimizer.service';
import { AutonomousActionStatus } from '@prisma/client';

@Injectable()
export class LearningLoopService {
  private readonly logger = new Logger(LearningLoopService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly promptOptimizer: PromptOptimizerService,
  ) {}

  /**
   * Record a system execution learning metric.
   */
  async recordMetric(params: {
    organizationId: string;
    metricName: string;
    value: number;
    dimensions?: Record<string, any>;
  }) {
    const { organizationId, metricName, value, dimensions } = params;

    return this.prisma.learningMetric.create({
      data: {
        organizationId,
        metricName,
        value,
        dimensions: dimensions ?? {},
      },
    }).catch((e) => this.logger.warn(`Failed to record learning metric: ${e.message}`));
  }

  /**
   * Run automated metric analysis and execute safe rollbacks if degradation thresholds are exceeded.
   */
  async analyzeMetricsAndSafeguard(organizationId: string): Promise<any[]> {
    const rollbackActions: any[] = [];
    const modes = ['study', 'quiz', 'flashcard'];

    for (const mode of modes) {
      // Find currently active prompt version for the mode
      const activePrompt = await this.promptOptimizer.getActivePrompt(mode);
      if (!activePrompt || activePrompt.version <= 1) continue;

      // 1. Get recent metrics for the active prompt
      const metrics = await this.prisma.learningMetric.findMany({
        where: {
          organizationId,
          metricName: 'rag_accuracy',
          dimensions: {
            path: ['promptVersion'],
            equals: activePrompt.version,
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 30, // Sample last 30 runs
      });

      if (metrics.length < 5) continue; // Need minimum samples to prevent noise trigger

      const avgAccuracy = metrics.reduce((sum, m) => sum + m.value, 0) / metrics.length;
      const baselineAccuracy = 85.0; // Benchmark threshold

      // 2. Perform safety trigger check: if accuracy drops below baseline
      if (avgAccuracy < baselineAccuracy) {
        this.logger.warn(`Safety Breach: Prompt version ${activePrompt.version} for mode ${mode} has degraded accuracy to ${avgAccuracy.toFixed(1)}%. Triggering automated rollback.`);
        
        // Execute rollback
        const rolledBackTo = await this.promptOptimizer.rollback(mode);

        // Record autonomous rollback action in DB
        const action = await this.prisma.autonomousAction.create({
          data: {
            organizationId,
            actionType: 'OPTIMIZATION',
            status: AutonomousActionStatus.ROLLED_BACK,
            triggerReason: `Safety breach: average RAG accuracy fell to ${avgAccuracy.toFixed(1)}% (threshold: ${baselineAccuracy}%).`,
            proposalDetails: {
              mode,
              degradedVersion: activePrompt.version,
              degradedAccuracy: avgAccuracy,
              rolledBackToVersion: rolledBackTo.version,
            },
            validationLogs: `AUTOMATED SYSTEM SAFEGUARD ROLLBACK ACTUATOR\nDeactivated prompt version ${activePrompt.version}.\nActivated previous stable version ${rolledBackTo.version}.\n`,
          },
        });

        rollbackActions.push(action);
      }
    }

    return rollbackActions;
  }
}
