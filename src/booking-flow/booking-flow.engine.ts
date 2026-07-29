import { Injectable } from '@nestjs/common';
import {
  BookingChannelEvent,
  BookingFlowResult,
} from './booking-flow.types';
import {
  Conversation,
  ConversationState,
} from '../conversations/entities/conversation.entity';

@Injectable()
export class BookingFlowEngine {
  async handle(
    conversation: Conversation,
    event: BookingChannelEvent,
  ): Promise<BookingFlowResult> {
    void conversation;
    void event;

    return {
      conversationState: ConversationState.IDLE,
      contextJson: {},
      reply: {
        kind: 'text',
        text: 'Hola',
      },
    };
  }
}
