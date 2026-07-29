import { ConversationState } from '../conversations/entities/conversation.entity';

export type BookingChannelEvent = {
  type: 'button' | 'list' | 'text';
  value: string;
};

export type BookingReplyAction =
  | {
      kind: 'text';
      text: string;
    }
  | {
      kind: 'buttons';
      text: string;
      buttons: Array<{ id: string; title: string }>;
    }
  | {
      kind: 'list';
      text: string;
      buttonText: string;
      sections: Array<{
        title: string;
        rows: Array<{ id: string; title: string; description?: string }>;
      }>;
    }
  | {
      kind: 'none';
      text: string;
    };

export type BookingFlowResult = {
  conversationState: ConversationState;
  contextJson: Record<string, unknown>;
  reply: BookingReplyAction;
  createdAppointmentId?: string;
};
