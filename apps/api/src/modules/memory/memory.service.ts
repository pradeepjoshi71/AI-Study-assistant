import { Injectable, Logger } from '@nestjs/common';
import { MemoryRepository } from './memory.repository';
import { MessageService } from '../messages/message.service';
import { ConversationService } from '../conversation/conversation.service';
import { SummarizerService } from './summarizer.service';
import { Message } from '../messages/message.entity';

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  private readonly threshold = 20; // Trigger summary if total messages count exceeds this
  private readonly keepRecent = 10; // Keep last 10 messages for short-term prompt context

  constructor(
    private memoryRepository: MemoryRepository,
    private messageService: MessageService,
    private conversationService: ConversationService,
    private summarizerService: SummarizerService,
  ) {}

  async getContextMemory(
    conversationId: string,
    userId: string,
    tenantId: string,
  ): Promise<{
    shortTermMessages: Message[];
    longTermSummary?: string;
  }> {
    // 1. Try Redis cache (Fast path)
    const cached = await this.memoryRepository.getMemory(conversationId);
    if (cached) {
      this.logger.log(`Redis memory cache hit for conversation: ${conversationId}`);
      return {
        shortTermMessages: cached.last_messages,
        longTermSummary: cached.summary || undefined,
      };
    }

    this.logger.log(`Redis memory cache miss for conversation: ${conversationId}. Fetching from DB...`);

    // 2. Fetch long-term summary from Postgres
    const conversation = await this.conversationService.findConversationById(conversationId, userId, tenantId);
    const summary = (conversation as any).summary || '';

    // 3. Fetch recent messages (short-term memory) from Postgres
    const allMessages = await this.messageService.findMessagesByConversation(
      conversationId,
      tenantId,
    );
    const messages = allMessages.slice(-this.keepRecent);

    // 4. Update Redis cache
    await this.memoryRepository.setMemory(conversationId, {
      summary,
      last_messages: messages,
      updated_at: Date.now(),
    });

    return {
      shortTermMessages: messages,
      longTermSummary: summary || undefined,
    };
  }

  async updateMemory(
    conversationId: string,
    userId: string,
    tenantId: string,
  ): Promise<void> {
    this.logger.log(`Queueing background memory processing for conversation: ${conversationId}`);
    
    // Spawn non-blocking background async update execution
    this.runAsyncUpdate(conversationId, userId, tenantId).catch((err) => {
      this.logger.error(`Background memory update failed for conversation ${conversationId}: ${err.message}`);
    });
  }

  private async runAsyncUpdate(
    conversationId: string,
    userId: string,
    tenantId: string,
  ): Promise<void> {
    // 1. Fetch total conversation messages list
    const allMessages = await this.messageService.findMessagesByConversation(conversationId, tenantId);

    // 2. Load current Postgres summary
    const conversation = await this.conversationService.findConversationById(conversationId, userId, tenantId);
    const previousSummary = (conversation as any).summary || '';

    let updatedSummary = previousSummary;

    // 3. If messages threshold is exceeded, trigger the summarizer engine
    if (allMessages.length > this.threshold) {
      // Summarize everything except the last 10 (recent context) messages
      const messagesToSummarize = allMessages.slice(0, allMessages.length - this.keepRecent);
      this.logger.log(`Threshold exceeded (${allMessages.length} messages). Summarizing older ${messagesToSummarize.length} messages...`);
      
      updatedSummary = await this.summarizerService.summarize(previousSummary, messagesToSummarize);

      // Save summary in Postgres
      await this.conversationService.updateSummary(conversationId, userId, tenantId, updatedSummary);
    }

    // 4. Extract recent short-term messages (keep last 10)
    const recentMessages = allMessages.slice(-this.keepRecent);

    // 5. Cache the compiled context memory in Redis
    await this.memoryRepository.setMemory(conversationId, {
      summary: updatedSummary,
      last_messages: recentMessages,
      updated_at: Date.now(),
    });

    this.logger.log(`Memory processing complete. Cache updated for conversation: ${conversationId}`);
  }
}
