import { Module } from '@nestjs/common';
import { StreamController } from './stream.controller';
import { StreamService } from './stream.service';
import { SseGateway } from './sse.gateway';
import { ConversationModule } from '../conversation/conversation.module';
import { MessagesModule } from '../messages/message.module';
import { ContextBuilderModule } from '../context-builder/context-builder.module';
import { PromptEngineModule } from '../prompt-engine/prompt-engine.module';
import { CitationsModule } from '../citations/citations.module';
import { MemoryModule } from '../memory/memory.module';

@Module({
  imports: [
    ConversationModule,
    MessagesModule,
    ContextBuilderModule,
    PromptEngineModule,
    CitationsModule,
    MemoryModule,
  ],
  controllers: [StreamController],
  providers: [StreamService, SseGateway],
  exports: [StreamService],
})
export class StreamingModule {}
