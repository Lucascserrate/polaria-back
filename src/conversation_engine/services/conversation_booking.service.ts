import { Injectable } from '@nestjs/common';
import { MessageRole } from '../../messages/entities/message.entity';
import { ConversationState } from '../../conversations/entities/conversation.entity';
import { ConversationAppointmentService } from './conversation_appointment.service';
import { ConversationIdentityService } from './conversation_identity.service';
import { ConversationMessagesService } from './conversation_messages.service';

@Injectable()
export class ConversationBookingService {
  constructor(
    private readonly conversationAppointmentService: ConversationAppointmentService,
    private readonly conversationIdentityService: ConversationIdentityService,
    private readonly conversationMessagesService: ConversationMessagesService,
  ) {}

  async confirmPending(input: {
    tenantId: string;
    clientId: string;
    conversationId: string;
    context: Record<string, unknown>;
    timezone?: string;
  }) {
    const pendingDatetime =
      typeof input.context.pendingDatetime === 'string'
        ? input.context.pendingDatetime
        : null;
    const pendingServiceIds = Array.isArray(input.context.serviceIds)
      ? (input.context.serviceIds as string[]).filter(
          (value) => typeof value === 'string',
        )
      : typeof input.context.serviceId === 'string'
        ? [input.context.serviceId]
        : [];
    const pendingStaffId =
      typeof input.context.staffId === 'string' ? input.context.staffId : null;

    if (!pendingDatetime || !pendingServiceIds.length) {
      return { handled: false as const };
    }

    const start = new Date(pendingDatetime);
    const appointment =
      !Number.isNaN(start.getTime()) &&
      (await this.conversationAppointmentService.createConfirmedAppointment({
        tenantId: input.tenantId,
        clientId: input.clientId,
        serviceIds: pendingServiceIds,
        startTime: start,
        staffId: pendingStaffId,
        timezone: input.timezone,
      }));

    const reply = appointment
      ? 'Listo, tu cita quedo confirmada. Te esperamos.'
      : 'No pude confirmar la cita. Puedes intentar con otro horario.';

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
