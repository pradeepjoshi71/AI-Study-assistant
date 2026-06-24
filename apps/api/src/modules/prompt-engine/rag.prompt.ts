import { RetrievedChunk } from '../retrieval/retrieval.service';
import { Message } from '../messages/message.entity';

export interface RagPromptInput {
  query: string;
  chatHistory: Message[];
  chatHistorySummary?: string;
  retrievedChunks: RetrievedChunk[];
  synthesizedContext?: string;
  conflicts?: string;
}
