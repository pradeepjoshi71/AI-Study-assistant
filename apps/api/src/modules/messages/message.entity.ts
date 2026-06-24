import { MessageRole } from '@prisma/client';

export class Message {
  id!: string;
  conversationId!: string;
  tenantId!: string;
  role!: MessageRole;
  content!: string;
  citations?: any;
  createdAt!: Date;
}
