import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageAbstractionService } from '../storage/storage-abstraction.service';
import { PolicyEngineService } from '../policy/policy-engine.service';
import { CostRouterService } from '../router/cost-router.service';
import { AiTaskStatus } from '@prisma/client';
import * as crypto from 'crypto';

export interface AgentContext {
  history: any[];
  systemPrompt: string;
  ragContext: string;
  graphContext: string;
}

@Injectable()
export class AgentKernelService {
  private readonly logger = new Logger(AgentKernelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageAbstractionService,
    private readonly policyEngine: PolicyEngineService,
    private readonly costRouter: CostRouterService,
  ) {}

  /**
   * Initializes a new Agent execution cycle session.
   */
  async startAgent(
    tenantId: string,
    agentId: string,
    sessionKey: string,
    systemPrompt: string,
  ): Promise<any> {
    this.logger.log(`Starting agent context lifecycle: agent=${agentId}, session=${sessionKey}`);

    // Create the execution task tracking record
    const task = await this.prisma.aiTask.create({
      data: {
        tenantId,
        type: 'AGENT_REASONING',
        status: AiTaskStatus.RUNNING,
        inputData: { agentId, sessionKey, systemPrompt },
      },
    });

    // Save initial state to memory storage
    const initialState: AgentContext = {
      history: [],
      systemPrompt,
      ragContext: '',
      graphContext: '',
    };
    await this.storageService.saveMemory(tenantId, sessionKey, initialState);

    return {
      taskId: task.id,
      sessionKey,
      status: AiTaskStatus.RUNNING,
    };
  }

  /**
   * Pauses an active session checkpoint.
   */
  async pauseAgent(tenantId: string, sessionKey: string, taskId: string): Promise<any> {
    this.logger.log(`Pausing agent session: ${sessionKey}`);
    
    await this.prisma.aiTask.update({
      where: { id: taskId, tenantId },
      data: { status: AiTaskStatus.QUEUED },
    });

    return { sessionKey, status: AiTaskStatus.QUEUED };
  }

  /**
   * Stops and tears down the session checkpoint.
   */
  async stopAgent(tenantId: string, sessionKey: string, taskId: string): Promise<any> {
    this.logger.log(`Stopping agent session: ${sessionKey}`);

    // Fetch accumulated costs for compute logs of this task
    const computeLogs = await this.prisma.aiComputeLog.findMany({
      where: { executionId: taskId },
    });

    const totalCost = computeLogs.reduce((acc, log) => acc + log.costCents, 0);
    const totalLatency = computeLogs.reduce((acc, log) => acc + log.latencyMs, 0);

    await this.prisma.aiTask.update({
      where: { id: taskId, tenantId },
      data: {
        status: AiTaskStatus.COMPLETED,
        costCents: totalCost,
        latencyMs: totalLatency,
      },
    });

    return { sessionKey, status: AiTaskStatus.COMPLETED, costCents: totalCost };
  }

  /**
   * Core Agent Execution Loop:
   * 1. Check Policy & Quota bounds
   * 2. Assemble context (short-term history, Qdrant vectors RAG, Knowledge Graph nodes)
   * 3. Select optimized LLM model unit (cheap vs premium)
   * 4. Perform execution and write new memories
   */
  async runAgentStep(
    tenantId: string,
    sessionKey: string,
    taskId: string,
    prompt: string,
  ): Promise<any> {
    const startTime = Date.now();
    
    // ── 1. Policy checks ──────────────────────────────────────
    await this.policyEngine.validateInputSafety(tenantId, prompt);
    await this.policyEngine.checkComputeQuota(tenantId, 'REASONING');

    // ── 2. Retrieve session state from Memory ──────────────────
    const agentCtx: AgentContext | null = await this.storageService.getMemory(tenantId, sessionKey);
    if (!agentCtx) {
      throw new NotFoundException(`Agent execution context not found for session key: ${sessionKey}`);
    }

    // ── 3. Assemble hybrid Context (RAG + Graph) ──────────────
    // A) RAG search
    const vectorChunks = await this.storageService.getContext(tenantId, prompt);
    const ragContext = vectorChunks.map((c) => c.text).join('\n');

    // B) Graph lookup
    const graphData = await this.storageService.retrieveGraph(tenantId, prompt);
    const graphContext = graphData 
      ? `Related concepts network: ${graphData.displayName} -> neighbors: ${graphData.neighbors.map((n: any) => n.conceptDisplayName).join(', ')}` 
      : '';

    // Update current contexts
    agentCtx.ragContext = ragContext;
    agentCtx.graphContext = graphContext;

    // ── 4. Cost-aware LLM Routing & Execution ─────────────────
    const inputHash = crypto.createHash('sha256').update(prompt + JSON.stringify(agentCtx.history)).digest('hex');
    let output = await this.costRouter.getCachedResponse(tenantId, inputHash);

    const computeUnit = this.costRouter.routeComputeUnit('REASONING', prompt.length);

    if (!output) {
      const fullSystemPrompt = `${agentCtx.systemPrompt}\n\n[RAG Context]\n${ragContext}\n\n[Graph Concepts]\n${graphContext}`;
      
      output = await this.costRouter.executeLlmCall(
        tenantId,
        taskId,
        fullSystemPrompt,
        prompt,
        computeUnit,
      );

      // Cache successful response
      await this.costRouter.setCachedResponse(tenantId, inputHash, output);
    }

    // ── 5. Save short-term memory update ──────────────────────
    agentCtx.history.push({ role: 'user', content: prompt });
    agentCtx.history.push({ role: 'assistant', content: output });
    
    await this.storageService.saveMemory(tenantId, sessionKey, agentCtx);

    // ── 6. Update task running telemetry ──────────────────────
    const stepDuration = Date.now() - startTime;
    await this.prisma.aiTask.update({
      where: { id: taskId, tenantId },
      data: {
        latencyMs: { increment: stepDuration },
      },
    });

    return {
      output,
      modelUsed: computeUnit.model,
      stepDurationMs: stepDuration,
    };
  }
}
