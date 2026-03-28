import { Injectable } from '@nestjs/common';
import { MessageRole } from '../../messages/entities/message.entity';
import { ConversationState } from '../../conversations/entities/conversation.entity';
import { ConversationAppointmentService } from './conversation_appointment.service';
import { ConversationAvailabilityService } from './conversation_availability.service';
import { ConversationIdentityService } from './conversation_identity.service';
import { ConversationMessagesService } from './conversation_messages.service';
import { ConversationStateService } from './conversation_state.service';
import { formatDateTime, formatTime } from '../utils/time_format';

@Injectable()
export class ConversationBookingService {
  constructor(
    private readonly conversationAppointmentService: ConversationAppointmentService,
    private readonly conversationAvailabilityService: ConversationAvailabilityService,
    private readonly conversationIdentityService: ConversationIdentityService,
    private readonly conversationMessagesService: ConversationMessagesService,
    private readonly conversationStateService: ConversationStateService,
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
    if (Number.isNaN(start.getTime())) {
      return { handled: false as const };
    }

    const durationMinutes =
      await this.conversationStateService.getServicesDurationMinutes(
        input.tenantId,
        pendingServiceIds,
      );
    if (!durationMinutes) {
      return { handled: false as const };
    }

    const end = addMinutes(start, durationMinutes);
    const isAvailable =
      await this.conversationAvailabilityService.isSlotAvailable(
        input.tenantId,
        start,
        end,
        input.timezone,
        pendingStaffId ?? undefined,
      );

    if (!isAvailable) {
      return this.handleUnavailable({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        clientId: input.clientId,
        context: input.context,
        start,
        durationMinutes,
        timezone: input.timezone,
        staffId: pendingStaffId ?? undefined,
      });
    }

    const appointment =
      await this.conversationAppointmentService.createConfirmedAppointment({
        tenantId: input.tenantId,
        clientId: input.clientId,
        serviceIds: pendingServiceIds,
        startTime: start,
        staffId: pendingStaffId,
        timezone: input.timezone,
      });

    if (!appointment) {
      return this.handleUnavailable({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        clientId: input.clientId,
        context: input.context,
        start,
        durationMinutes,
        timezone: input.timezone,
        staffId: pendingStaffId ?? undefined,
      });
    }

    const reply = `Listo, tu cita quedó confirmada para ${formatDateTime(
      start,
      input.timezone,
    )}. Te esperamos.`;

    await this.conversationMessagesService.saveMessage({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      clientId: input.clientId,
      role: MessageRole.ASSISTANT,
      content: reply,
    });

    delete input.context.pendingDatetime;
    delete input.context.pendingServiceIds;
    delete input.context.pendingStaffId;
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

  private async handleUnavailable(input: {
    tenantId: string;
    conversationId: string;
    clientId: string;
    context: Record<string, unknown>;
    start: Date;
    durationMinutes: number;
    timezone?: string;
    staffId?: string;
  }) {
    const alternatives =
      await this.conversationAvailabilityService.getAlternativeTimes({
        tenantId: input.tenantId,
        start: input.start,
        durationMinutes: input.durationMinutes,
        limit: 3,
        stepMinutes: input.durationMinutes,
        timezone: input.timezone,
        staffId: input.staffId ?? undefined,
      });
    const formatted = alternatives.map((slot) =>
      formatTime(slot, input.timezone),
    );
    const reply = formatted.length
      ? `Lo siento, ese horario ya no está disponible. Tengo ${formatted.join(
          ', ',
        )}. ¿Quieres alguna de esas opciones?`
      : 'Lo siento, ese horario ya no está disponible. ¿Quieres otra hora o día?';

    delete input.context.pendingDatetime;
    delete input.context.pendingServiceIds;
    delete input.context.pendingStaffId;
    input.context.lastAlternatives = formatted;
    input.context.lastDate = input.start.toISOString().slice(0, 10);
    await this.conversationIdentityService.updateConversationContext(
      input.conversationId,
      input.context,
    );
    await this.conversationIdentityService.touchConversation(
      input.conversationId,
      ConversationState.IDLE,
    );
    await this.conversationMessagesService.saveMessage({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      clientId: input.clientId,
      role: MessageRole.ASSISTANT,
      content: reply,
    });
    return { handled: true as const, reply };
  }
}

function addMinutes(date: Date, minutes: number) {
  const result = new Date(date);
  result.setMinutes(result.getMinutes() + minutes);
  return result;
}
