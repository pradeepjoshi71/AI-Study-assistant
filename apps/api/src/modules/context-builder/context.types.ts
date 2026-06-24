import { Message } from '../messages/message.entity';
import { GroupedChunks, RetrievedChunkWithTitle } from '../retrieval/multi-doc.retrieval';

export interface ContextBuilderInput {
  conversationId: string;
  userQuery: string;
  documentIds?: string[];
  tenantId: string;
  userId: string;
}

export interface ContextBuilderOutput {
  query: string;
  chatHistorySummary?: string;
  recentMessages: Message[];
  retrievedChunks: RetrievedChunkWithTitle[];
  groupedChunks: GroupedChunks;
  synthesizedContext?: string;
  conflicts?: string;
  metadata: {
    tenantId: string;
    userId: string;
    conversationId: string;
    documentIdsFiltered?: string[];
  };
}
