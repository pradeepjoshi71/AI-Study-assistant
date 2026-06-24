import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ConversationModule } from '../conversation/conversation.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { CitationsModule } from '../citations/citations.module';
import { PromptEngineModule } from '../prompt-engine/prompt-engine.module';
import { ContextBuilderModule } from '../context-builder/context-builder.module';

@Module({
  imports: [
    ConversationModule,
    RetrievalModule,
    CitationsModule,
    PromptEngineModule,
    ContextBuilderModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
