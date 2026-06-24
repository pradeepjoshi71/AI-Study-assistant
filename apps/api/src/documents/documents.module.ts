import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { RagController } from './rag.controller';
import { StorageModule } from '../storage/storage.module';
import { QueuesModule } from '../queues/queues.module';

@Module({
  imports: [StorageModule, QueuesModule],
  controllers: [DocumentsController, RagController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
