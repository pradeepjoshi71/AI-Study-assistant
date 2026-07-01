import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';

@Processor('group-document-sync')
export class GroupDocumentSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(GroupDocumentSyncProcessor.name);
  private readonly aiServiceUrl: string;

  constructor(private readonly config: ConfigService) {
    super();
    this.aiServiceUrl = this.config.get<string>(
      'NEXT_PUBLIC_AI_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  async process(job: Job<any>): Promise<any> {
    const { action, groupId, docId, addedBy } = job.data as {
      action: 'copy' | 'delete';
      groupId: string;
      docId: string;
      addedBy?: string;
    };

    this.logger.log(`Running group document sync: action=${action} groupId=${groupId} docId=${docId}`);

    const url = `${this.aiServiceUrl}/ai/group/docs/${action === 'copy' ? 'add' : 'remove'}`;
    const body = action === 'copy'
      ? { docId, groupId, addedBy: addedBy || 'system' }
      : { docId, groupId };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000), // 1 min timeout
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`FastAPI document sync request failed: ${res.statusText} - ${text}`);
      }

      this.logger.log(`Successfully completed document sync: action=${action} groupId=${groupId} docId=${docId}`);
      return { success: true };
    } catch (err: any) {
      this.logger.error(`Document sync processor failed: ${err.message}`);
      throw err; // let BullMQ retry
    }
  }
}

