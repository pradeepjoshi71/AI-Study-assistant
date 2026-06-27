import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { SseGateway } from './sse.gateway';

@Injectable()
export class StreamService {
  private readonly logger = new Logger(StreamService.name);
  private readonly aiServiceUrl: string;

  constructor(
    private configService: ConfigService,
    private sseGateway: SseGateway,
  ) {
    this.aiServiceUrl = this.configService.get<string>('NEXT_PUBLIC_AI_SERVICE_URL', 'http://localhost:8000');
  }

  async pipeStream(
    systemPrompt: string,
    message: string,
    history: any[],
    citations: any[],
    res: Response,
  ): Promise<string> {
    const url = `${this.aiServiceUrl}/ai/chat/stream`;
    this.logger.log(`Forwarding chat stream request to AI service: ${url}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemPrompt,
          message,
          history,
          citations,
        }),
      });

      if (!response.ok || !response.body) {
        this.logger.error(`AI service stream initiation failed: ${response.statusText}`);
        this.sseGateway.sendError(res, 'AI Service stream failed to start.');
        this.sseGateway.sendDone(res);
        return '';
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedText = '';

      let isDone = false;
      while (!isDone) {
        const { done, value } = await reader.read();
        if (done) {
          isDone = true;
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          if (line.startsWith('event: ')) {
            const eventName = line.replace('event: ', '').trim();
            const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';

            if (nextLine && nextLine.startsWith('data: ')) {
              const dataStr = nextLine.replace('data: ', '').trim();
              i++; // skip reading data line in loop

              if (eventName === 'token') {
                accumulatedText += dataStr;
                this.sseGateway.sendEvent(res, 'token', dataStr);
              } else if (eventName === 'citation') {
                try {
                  const citationObj = JSON.parse(dataStr);
                  this.sseGateway.sendEvent(res, 'citation', citationObj);
                } catch {
                  this.sseGateway.sendEvent(res, 'citation', dataStr);
                }
              } else if (eventName === 'done') {
                try {
                  const doneObj = JSON.parse(dataStr);
                  this.sseGateway.sendEvent(res, 'done', doneObj);
                } catch {
                  this.sseGateway.sendEvent(res, 'done', dataStr);
                }
              } else if (eventName === 'error') {
                this.sseGateway.sendError(res, dataStr);
              }
            }
          }
        }
      }

      // Stream remainder
      if (buffer.trim()) {
        this.logger.warn(`Remaining buffer streamed: ${buffer}`);
      }

      return accumulatedText;

    } catch (err: any) {
      this.logger.error(`Streaming bridge interrupted: ${err.message}`);
      this.sseGateway.sendError(res, 'AI stream pipeline connection error.');
      this.sseGateway.sendDone(res);
      return '';
    }
  }
}
