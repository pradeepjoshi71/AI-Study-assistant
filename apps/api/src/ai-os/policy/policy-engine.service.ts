import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PlanType } from '@prisma/client';

@Injectable()
export class PolicyEngineService {
  private readonly logger = new Logger(PolicyEngineService.name);

  // A basic list of dangerous prompt/SQL keywords for security guard validations
  private readonly blockedKeywords = [
    'drop table',
    'truncate table',
    'delete from users',
    'system prompt bypass',
    'ignore previous instructions',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Validates if a tenant can execute a specific tool or action based on plan constraints.
   */
  async validateToolExecution(
    tenantId: string,
    toolName: string,
    toolPermissions: string[],
  ): Promise<boolean> {
    this.logger.log(`Validating policy rules for tenant=${tenantId}, tool=${toolName}`);

    // Fetch subscription plan type
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId: tenantId },
      include: { plan: true },
    });

    const planType = subscription?.plan?.type ?? PlanType.FREE;

    // 1. External API / custom scripts are blocked for FREE plans
    if (planType === PlanType.FREE) {
      if (toolPermissions.includes('external_api_call') || toolPermissions.includes('execute_code')) {
        await this.auditService.log({
          organizationId: tenantId,
          actorType: 'system',
          action: 'POLICY_VIOLATION',
          resourceType: 'tool',
          resourceId: toolName,
          metadata: {
            reason: 'FREE plan blocked from executing external api/code tools',
            planType,
          },
        });
        throw new ForbiddenException(
          'Execution of external APIs or code-running tools is not allowed on the Free tier. Please upgrade to Pro or Enterprise.',
        );
      }
    }

    return true;
  }

  /**
   * Validates safety of input payload to prevent injection or malicious inputs.
   */
  async validateInputSafety(tenantId: string, inputString: string): Promise<boolean> {
    const normalizedInput = inputString.toLowerCase();
    
    for (const keyword of this.blockedKeywords) {
      if (normalizedInput.includes(keyword)) {
        await this.auditService.logSecurityEvent({
          organizationId: tenantId,
          eventType: 'prompt_injection_attempt',
          severity: 'WARNING',
          metadata: {
            keywordTriggered: keyword,
            inputSnippet: inputString.slice(0, 100),
          },
        });
        throw new ForbiddenException(
          `Security violation: Dangerous command or prompt injection keyword detected ("${keyword}").`,
        );
      }
    }

    return true;
  }

  /**
   * Enforces compute execution limits per tier.
   */
  async checkComputeQuota(tenantId: string, type: string): Promise<boolean> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId: tenantId },
      include: { plan: true },
    });

    const planType = subscription?.plan?.type ?? PlanType.FREE;

    // If free tier, restrict advanced reasoning or batch jobs
    if (planType === PlanType.FREE && (type === 'REASONING' || type === 'BATCH')) {
      await this.auditService.log({
        organizationId: tenantId,
        actorType: 'system',
        action: 'POLICY_VIOLATION',
        resourceType: 'compute',
        metadata: {
          reason: `FREE plan blocked from executing ${type} workloads`,
          planType,
        },
      });
      throw new ForbiddenException(
        `High-overhead ${type} compute tasks are restricted on the Free plan. Please upgrade.`,
      );
    }

    return true;
  }
}
