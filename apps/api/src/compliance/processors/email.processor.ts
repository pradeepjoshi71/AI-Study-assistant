import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
@Processor('email')
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  async process(job: Job<any>): Promise<void> {
    const { to, subject, body, downloadUrl } = job.data;
    
    this.logger.log(`[Email Sent] To: ${to} | Subject: ${subject}`);
    this.logger.log(`[Email Body]:\n${body}`);
    
    if (downloadUrl) {
      this.logger.log(`[Download Link]: ${downloadUrl}`);
    }
  }
}
