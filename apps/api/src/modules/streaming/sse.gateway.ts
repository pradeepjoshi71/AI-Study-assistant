import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';

@Injectable()
export class SseGateway {
  private readonly logger = new Logger(SseGateway.name);

  sendEvent(res: Response, eventName: string, data: any): void {
    const dataString = typeof data === 'object' ? JSON.stringify(data) : data;
    res.write(`event: ${eventName}\ndata: ${dataString}\n\n`);
  }

  sendError(res: Response, message: string): void {
    this.logger.warn(`Emitting error event to SSE client: ${message}`);
    res.write(`event: error\ndata: ${message}\n\n`);
  }

  sendDone(res: Response, metadata: any = {}): void {
    this.logger.log('Emitting done event and closing SSE stream.');
    res.write(`event: done\ndata: ${JSON.stringify(metadata)}\n\n`);
    res.end();
  }
}
