import { Injectable } from '@nestjs/common';
import { MessageRole } from '../../messages/entities/message.entity';
import { ConversationState } from '../../conversations/entities/conversation.entity';
import { ConversationAppointmentService } from './conversation_appointment.service';
import { ConversationConfirmationService } from './conversation_confirmation.service';
import { ConversationIdentityService } from './conversation_identity.service';
import { ConversationMessagesService } from './conversation_messages.service';

@Injectable()
export class ConversationBookingService {
  constructor(
    private readonly conversationAppointmentService: ConversationAppointmentService,
    private readonly conversationConfirmationService: ConversationConfirmationService,
    private readonly conversationIdentityService: ConversationIdentityService,
    private readonly conversationMessagesService: ConversationMessagesService,
  ) {}

  async tryConfirmAndCreate(input: {
    tenantId: string;
    message: string;
    clientId: string;
    conversationId: string;
    context: Record<string, unknown>;
  }) {
    const pendingDatetime =
      typeof input.context.pendingDatetime === 'string'
        ? input.context.pendingDatetime
        : null;
    const pendingServiceId =
      typeof input.context.serviceId === 'string'
        ? input.context.serviceId
        : null;

    if (
      !this.conversationConfirmationService.isConfirm(input.message) ||
      !pendingDatetime ||
      !pendingServiceId
    ) {
      return { handled: false as const };
    }

    const start = new Date(pendingDatetime);
    const appointment =
      !Number.isNaN(start.getTime()) &&
      (await this.conversationAppointmentService.createConfirmedAppointment({
        tenantId: input.tenantId,
        clientId: input.clientId,
        serviceId: pendingServiceId,
        startTime: start,
      }));

    const reply = appointment
      ? 'Listo, tu cita quedo confirmada. Te esperamos.'
      : 'No pude confirmar la cita. Puedes intentar con otro horario.';

    await this.conversationMessagesService.saveMessage({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      clientId: input.clientId,
      role: MessageRole.USER,
      content: input.message,
    });
    await this.conversationMessagesService.saveMessage({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      clientId: input.clientId,
      role: MessageRole.ASSISTANT,
      content: reply,
    });

    delete input.context.pendingDatetime;
    await this.conversationIdentityService.updateConversationContext(
      input.conversationId,
      input.context,
    );
    await this.conversationIdentityService.touchConversation(
      input.conversationId,
      appointment ? ConversationState.BOOKING_COMPLETE : ConversationState.IDLE,
    );

    return { handled: true as const, reply };
  }
}
