import { Module } from '@nestjs/common';
import { MemoryRepository } from './memory.repository';
import { SummarizerService } from './summarizer.service';
import { MemoryService } from './memory.service';
import { RedisModule } from '../../redis/redis.module';
import { MessagesModule } from '../messages/message.module';
import { ConversationModule } from '../conversation/conversation.module';

@Module({
  imports: [
    RedisModule,
    MessagesModule,
    ConversationModule,
  ],
  providers: [MemoryRepository, SummarizerService, MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
