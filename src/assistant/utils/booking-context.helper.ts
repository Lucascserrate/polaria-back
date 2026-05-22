import type { AssistantParsedResponse } from './assistant-response-parser';
import type { AssistantEntities } from '../types/assistant-entities.type';
import type { AssistantChatDto } from '../dto/assistant-chat.dto';
import type { Client } from '../../clients/entities/client.entity';
import type { Conversation } from '../../conversations/entities/conversation.entity';
import { ConversationState } from '../../conversations/entities/conversation.entity';
import type { ConversationsService } from '../../conversations/conversations.service';
import type { MessagesService } from '../../messages/messages.service';
import { MessageRole } from '../../messages/entities/message.entity';
import { buildResetContext, mergeIncomingWithStored } from './assistant-flow';

export { buildResetContext, mergeIncomingWithStored };

export const handleBookingContext = async (params: {
  conversation: Conversation;
  entities: AssistantParsedResponse['entities'] | undefined;
  action: string | undefined;
  reply: string;
  input: AssistantChatDto;
  client: Client;
  conversationsService: ConversationsService;
  messagesService: MessagesService;
}): Promise<
  | {
      handled: true;
      response: { reply: string; conversationId: string; clientId: string };
    }
  | {
      handled: false;
      entities: AssistantParsedResponse['entities'] | undefined;
      action: string | undefined;
      shouldShowHours: boolean;
    }
> => {
  const {
    conversation,
    entities,
    action,
    reply,
    input,
    client,
    conversationsService,
    messagesService,
  } = params;

  const storedEntities = (conversation.contextJson?.entities ??
    {}) as Partial<AssistantEntities>;
  const mergedEntities = mergeIncomingWithStored(entities, storedEntities);

  const isBookingComplete =
    conversation.currentState === ConversationState.BOOKING_COMPLETE;
  const hasNewService =
    Array.isArray(mergedEntities?.services) &&
    mergedEntities.services.length > 0;

  if (isBookingComplete && action === 'CONFIRM_BOOKING') {
    await messagesService.create({
      tenantId: input.tenantId,
      conversationId: conversation.id,
      clientId: client.id,
      role: MessageRole.ASSISTANT,
      content: reply,
    });
    await conversationsService.update(conversation.id, {
      lastMessageAt: new Date(),
    });
    return {
      handled: true,
      response: {
        reply,
        conversationId: conversation.id,
        clientId: client.id,
      },
    };
  }

  if (isBookingComplete && hasNewService) {
    const updatedContext = buildResetContext(conversation);
    await conversationsService.update(conversation.id, {
      currentState: ConversationState.IDLE,
      contextJson: updatedContext,
    });
    conversation.contextJson = updatedContext;
    conversation.currentState = ConversationState.IDLE;
  }

  if (isBookingComplete && !hasNewService) {
    await messagesService.create({
      tenantId: input.tenantId,
      conversationId: conversation.id,
      clientId: client.id,
      role: MessageRole.ASSISTANT,
      content: reply,
    });
    await conversationsService.update(conversation.id, {
      lastMessageAt: new Date(),
    });
    return {
      handled: true,
      response: {
        reply,
        conversationId: conversation.id,
        clientId: client.id,
      },
    };
  }

  const hasServices =
    Array.isArray(mergedEntities?.services) &&
    mergedEntities.services.length > 0;
  const hasDate =
    typeof mergedEntities?.date === 'string' && mergedEntities.date.length > 0;

  // Solo mostrar horas cuando el AI explícitamente dice SHOW_HOURS
  const shouldShowHours = action === 'SHOW_HOURS' && hasServices && hasDate;

  return {
    handled: false,
    entities: mergedEntities,
    action,
    shouldShowHours,
  };
};
