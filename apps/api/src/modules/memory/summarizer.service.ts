import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Message } from '../messages/message.entity';

@Injectable()
export class SummarizerService {
  private readonly logger = new Logger(SummarizerService.name);
  private readonly aiServiceUrl: string;

  constructor(private configService: ConfigService) {
    this.aiServiceUrl = this.configService.get<string>('NEXT_PUBLIC_AI_SERVICE_URL', 'http://localhost:8000');
  }

  async summarize(
    previousSummary: string,
    newMessages: Message[],
  ): Promise<string> {
    const url = `${this.aiServiceUrl}/ai/memory/summarize`;
    this.logger.log(`Calling FastAPI memory summarizer at: ${url}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          previousSummary,
          newMessages: newMessages.map((msg) => ({
            role: msg.role.toLowerCase(),
            content: msg.content,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`AI service summarize request failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data.summary || '';
    } catch (err: any) {
      this.logger.error(`Error executing conversation summarization: ${err.message}`);
      return previousSummary; // fallback to keeping previous summary intact
    }
  }
}
