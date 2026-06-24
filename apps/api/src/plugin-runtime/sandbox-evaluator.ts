import * as vm from 'vm';
import { BadRequestException } from '@nestjs/common';

export class SandboxEvaluator {
  /**
   * Safely execute JavaScript plugin code inside a Node VM sandbox context.
   *
   * Rules:
   *   - No access to require(), process, fs, net, global.
   *   - Strict CPU execution timeout (1000ms).
   *   - Input data is passed as a global `input` object.
   *   - The code must return the output values or assign them to a value.
   */
  static evaluate(scriptCode: string, inputData: any): any {
    const resultBox = { result: null, error: null };

    // Strict sanitization of VM globals
    const sandbox = {
      input: inputData,
      resultBox,
      // Allowed helper namespaces
      Math,
      JSON,
      Date,
      String,
      Number,
      Array,
      Object,
      RegExp,
      Boolean,
      Buffer,
    };

    const context = vm.createContext(sandbox);

    // Wrap execution in an immediately-invoked function expression
    const wrappedCode = `
      try {
        const run = () => {
          ${scriptCode}
        };
        resultBox.result = run();
      } catch (err) {
        resultBox.error = err.message;
      }
    `;

    try {
      vm.runInNewContext(wrappedCode, context, {
        timeout: 1000, // 1 second CPU time cap
        displayErrors: true,
        breakOnSigint: true,
      });

      if (sandbox.resultBox.error) {
        throw new BadRequestException(`Sandbox Execution Error: ${sandbox.resultBox.error}`);
      }

      return sandbox.resultBox.result;
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`Sandbox Execution Failed: ${err.message}`);
    }
  }
}
