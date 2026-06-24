import { Module } from '@nestjs/common';
import { ContextBuilderService } from './context-builder.service';
import { ConversationModule } from '../conversation/conversation.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [ConversationModule, RedisModule],
  providers: [ContextBuilderService],
  exports: [ContextBuilderService],
})
export class ContextBuilderModule {}
