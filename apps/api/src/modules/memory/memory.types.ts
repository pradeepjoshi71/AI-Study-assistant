import { Message } from '../messages/message.entity';

export interface ChatMemory {
  summary: string;
  last_messages: Message[];
  updated_at: number;
}
