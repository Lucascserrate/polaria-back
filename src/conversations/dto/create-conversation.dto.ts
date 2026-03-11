import { ConversationState } from '../entities/conversation.entity';

export class CreateConversationDto {
  tenantId: string;
  clientId: string;
  currentState?: ConversationState;
  contextJson?: any;
  lastMessageAt?: Date;
}
