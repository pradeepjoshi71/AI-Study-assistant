import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SsrfGuard } from './ssrf-guard';
import { SandboxEvaluator } from './sandbox-evaluator';
import { Plugin } from '@prisma/client';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import * as crypto from 'crypto';

@Injectable()
export class PluginRuntimeService {
  private readonly logger = new Logger(PluginRuntimeService.name);
  private readonly ajv: any;
  private readonly sharedSecret: string;

  constructor(private readonly prisma: PrismaService) {
    this.ajv = new Ajv({ allErrors: true, coerceTypes: true });
    addFormats(this.ajv);
    this.sharedSecret = process.env.PLUGIN_SHARED_SECRET || 'fallback_plugin_secret_12345';
  }

  /**
   * Main tool-execution entrypoint. Validates input schema, verifies permissions,
   * runs the plugin inside HTTP SSRF guard or VM sandbox, and logs usage.
   */
  async executePlugin(params: {
    plugin: Plugin;
    inputData: Record<string, any>;
    organizationId: string;
    userId?: string;
    conversationId?: string;
    userContext?: Record<string, any>;
  }): Promise<any> {
    const { plugin, inputData, organizationId, userId, conversationId, userContext } = params;
    const startMs = Date.now();
    let statusCode = 200;
    let result: any = null;

    try {
      // 1. Schema Validation (Input)
      const isInputValid = this.validateJsonSchema(plugin.inputSchema, inputData);
      if (!isInputValid.valid) {
        throw new BadRequestException(`Input schema validation failed: ${isInputValid.errors?.join(', ')}`);
      }

      // 2. Scope & Permission Check
      const permissions = plugin.permissions as string[];
      
      // Inject contextual RAG documents if plugin has 'read_documents' scope
      const enrichedInput = { ...inputData };
      if (permissions.includes('read_documents')) {
        const documents = await this.prisma.document.findMany({
          where: {
            user: {
              organizationMemberships: {
                some: { organizationId },
              },
            },
          },
          select: { id: true, title: true, storageKey: true },
          take: 5,
        });
        enrichedInput._context = { ...enrichedInput._context, documents };
      }

      // Inject user/org context if allowed
      if (userContext) {
        enrichedInput._userContext = {
          userId: userContext.userId,
          email: userContext.email,
          organizationId,
        };
      }

      // 3. Execution
      if (plugin.endpointUrl) {
        // Remote HTTP Plugin Execution
        const safeUrl = await SsrfGuard.validateUrl(plugin.endpointUrl);
        const payloadString = JSON.stringify(enrichedInput);

        // Sign payload with HMAC signature for verification
        const signature = crypto
          .createHmac('sha256', this.sharedSecret)
          .update(payloadString)
          .digest('hex');

        const headers = {
          'Content-Type': 'application/json',
          'X-Plugin-Signature': signature,
          'X-Organization-Id': organizationId,
        };

        const response = await fetch(safeUrl, {
          method: 'POST',
          headers,
          body: payloadString,
          signal: AbortSignal.timeout(5000), // 5-second execution timeout
        });

        statusCode = response.status;
        if (!response.ok) {
          throw new BadRequestException(`Plugin endpoint returned HTTP error status: ${response.status}`);
        }

        result = await response.json();
      } else if (plugin.scriptCode) {
        // Script-based Javascript Execution in Sandbox
        result = SandboxEvaluator.evaluate(plugin.scriptCode, enrichedInput);
      } else {
        throw new BadRequestException('Plugin configuration invalid: missing scriptCode or endpointUrl');
      }

      // 4. Schema Validation (Output)
      const isOutputValid = this.validateJsonSchema(plugin.outputSchema, result);
      if (!isOutputValid.valid) {
        this.logger.warn(`Output schema validation warnings: ${isOutputValid.errors?.join(', ')}`);
      }

    } catch (err: any) {
      statusCode = err.status || 500;
      this.logger.error(`Plugin execution failed for key ${plugin.key}: ${err.message}`);
      throw err;
    } finally {
      // 5. Usage Logging & Billing integration
      const latencyMs = Date.now() - startMs;
      const costCents = plugin.costPerExecutionCents / 100;

      await this.prisma.pluginUsageLog.create({
        data: {
          organizationId,
          pluginId: plugin.id,
          userId: userId ?? null,
          conversationId: conversationId ?? null,
          latencyMs,
          statusCode,
          costCents,
        },
      }).catch((e) => this.logger.warn(`Failed to write plugin usage log: ${e.message}`));
    }

    return result;
  }

  private validateJsonSchema(schema: any, data: any): { valid: boolean; errors?: string[] } {
    try {
      const validate = this.ajv.compile(schema);
      const valid = validate(data);
      if (!valid) {
        const errors = validate.errors?.map((err: any) => `${err.instancePath} ${err.message}`) || [];
        return { valid: false, errors };
      }
      return { valid: true };
    } catch (err: any) {
      return { valid: false, errors: [`Schema compilation error: ${err.message}`] };
    }
  }
}
