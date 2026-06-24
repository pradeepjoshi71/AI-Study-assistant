import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { SandboxEvaluator } from '../plugin-runtime/sandbox-evaluator';
import { AutonomousActionStatus } from '@prisma/client';

@Injectable()
export class ToolGeneratorService {
  private readonly logger = new Logger(ToolGeneratorService.name);
  private readonly geminiApiKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.geminiApiKey = this.config.get<string>('GEMINI_API_KEY', '');
  }

  /**
   * Generates a new tool using Gemini based on natural language description,
   * compiles the code + schema, runs sandboxed test cases, and saves as a draft.
   */
  async generateTool(params: {
    prompt: string;
    organizationId: string;
  }): Promise<any> {
    const { prompt, organizationId } = params;

    if (!this.geminiApiKey || this.geminiApiKey === 'your_gemini_api_key_here') {
      this.logger.warn('Gemini API key is missing. Using fallback mock tool generator.');
      return this.generateMockTool(prompt, organizationId);
    }

    const systemPrompt = `You are a Principal Software Engineer and Autonomous Code Architect.
Your task is to convert a natural language request for an AI Study Assistant tool into a fully functional sandboxed JavaScript plugin.
You must output a single JSON object (and nothing else) with the following structure:
{
  "key": "unique_lowercase_snake_case_key",
  "name": "Human-Readable Tool Name",
  "description": "Detailed explanation of what the tool accomplishes.",
  "permissions": ["read_documents"], // List of scopes: read_documents, write_notes, access_chat_context, external_api_call
  "inputSchema": {
    "type": "object",
    "properties": {
      "inputField": { "type": "string", "description": "description..." }
    },
    "required": ["inputField"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "outputField": { "type": "string" }
    }
  },
  "scriptCode": "const inputVal = input.inputField;\\n// JavaScript code logic\\nreturn { outputField: inputVal };",
  "testCases": [
    {
      "input": { "inputField": "sample value" },
      "expected": { "outputField": "sample value" }
    }
  ]
}

Rules for scriptCode:
- Code runs inside Node.js vm module (isolated sandbox).
- Access input values from the global \`input\` object.
- DO NOT use require(), fs, process, child_process, network modules, or direct DB.
- Use basic JavaScript syntax (ES6 math, loops, array manipulations, regex, JSON).
- The script must terminate by using the \`return\` statement returning a JSON serializable object.
- Make the code robust, check for undefined values, and handle edge cases gracefully.`;

    const userPrompt = `Generate a tool for this request: "${prompt}"`;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              { role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Gemini API returned status ${response.status}: ${response.statusText}`);
      }

      const resJson = await response.json();
      const contentText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!contentText) {
        throw new Error('Gemini response has empty text output');
      }

      const toolSpec = JSON.parse(contentText);
      return this.validateAndRegisterGeneratedTool(toolSpec, organizationId, `User request: ${prompt}`);
    } catch (err: any) {
      this.logger.error(`Failed to automatically generate tool: ${err.message}`);
      throw new BadRequestException(`Auto tool generation failed: ${err.message}`);
    }
  }

  /**
   * Helper that executes the validation sandbox pipeline for a tool spec and writes to DB.
   */
  async validateAndRegisterGeneratedTool(
    spec: any,
    organizationId: string,
    triggerReason: string,
  ): Promise<any> {
    const { key, name, description, permissions, inputSchema, outputSchema, scriptCode, testCases } = spec;
    
    let status: AutonomousActionStatus = AutonomousActionStatus.PENDING_APPROVAL;
    let validationLogs = '--- Autopilot Sandbox Validation Suite ---\n';
    let passedCount = 0;

    try {
      if (!key || !name || !scriptCode || !testCases || !Array.isArray(testCases)) {
        throw new Error('Missing core specifications: key, name, scriptCode, and testCases are mandatory.');
      }

      // Execute each test case in sandbox
      for (let idx = 0; idx < testCases.length; idx++) {
        const tc = testCases[idx];
        validationLogs += `Running Case #${idx + 1}: Input: ${JSON.stringify(tc.input)}\n`;
        
        const result = SandboxEvaluator.evaluate(scriptCode, tc.input);
        validationLogs += `Execution Output: ${JSON.stringify(result)}\n`;
        
        // Simple assertion matching (if expected is present)
        if (tc.expected) {
          const matched = this.deepMatch(result, tc.expected);
          if (!matched) {
            throw new Error(`Execution mismatch on Case #${idx + 1}. Expected: ${JSON.stringify(tc.expected)}, Got: ${JSON.stringify(result)}`);
          }
          validationLogs += `✔ Case #${idx + 1} assertion PASSED!\n`;
        } else {
          validationLogs += `✔ Case #${idx + 1} completed with no exceptions.\n`;
        }
        passedCount++;
      }
      validationLogs += `\nSuccess: Validation suite completed. ${passedCount}/${testCases.length} tests passed successfully.\n`;
    } catch (err: any) {
      status = AutonomousActionStatus.FAILED;
      validationLogs += `\n✖ Validation FAILED: ${err.message}\n`;
      this.logger.warn(`Generated tool validation failed: ${err.message}`);
    }

    // 1. Create AiGeneratedTool draft in database
    const tool = await this.prisma.aiGeneratedTool.create({
      data: {
        organizationId,
        name,
        key,
        description,
        inputSchema,
        outputSchema,
        scriptCode,
        testSuiteData: testCases || [],
        status,
      },
    });

    // 2. Create AutonomousAction request entry
    await this.prisma.autonomousAction.create({
      data: {
        organizationId,
        actionType: 'PLUGIN_CREATE',
        status,
        triggerReason,
        proposalDetails: {
          generatedToolId: tool.id,
          key,
          name,
          description,
          permissions,
          inputSchema,
          outputSchema,
          scriptCode,
        },
        validationLogs,
      },
    });

    return {
      toolId: tool.id,
      key,
      name,
      status,
      validationLogs,
    };
  }

  private deepMatch(actual: any, expected: any): boolean {
    if (actual === expected) return true;
    if (typeof actual !== typeof expected) return false;
    if (actual && typeof actual === 'object') {
      for (const k of Object.keys(expected)) {
        if (!this.deepMatch(actual[k], expected[k])) return false;
      }
      return true;
    }
    return false;
  }

  /**
   * Fallback generation model when Gemini API is unauthenticated/offline.
   */
  private async generateMockTool(prompt: string, organizationId: string): Promise<any> {
    const mockSpec = {
      key: `auto_${prompt.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 16)}_${Date.now().toString().slice(-4)}`,
      name: `Auto ${prompt.split(' ').slice(0, 3).join(' ')}`,
      description: `AI-Generated tool satisfying request: "${prompt}"`,
      permissions: ['read_documents'],
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      outputSchema: { type: 'object', properties: { wordCount: { type: 'number' }, status: { type: 'string' } } },
      scriptCode: `const textStr = input.text || '';\nreturn { wordCount: textStr.split(' ').length, status: 'processed' };`,
      testCases: [
        {
          input: { text: "Hello study room assistant" },
          expected: { wordCount: 4, status: "processed" }
        }
      ]
    };

    return this.validateAndRegisterGeneratedTool(mockSpec, organizationId, `User request (Mocked): ${prompt}`);
  }
}
