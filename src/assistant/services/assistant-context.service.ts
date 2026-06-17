import { Injectable } from '@nestjs/common';
import { AppointmentsService } from '../../appointments/appointments.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { ConversationState } from '../../conversations/entities/conversation.entity';
import type { Client } from '../../clients/entities/client.entity';
import type { Conversation } from '../../conversations/entities/conversation.entity';
import type { AssistantEntities } from '../types/assistant-entities.type';
import {
  buildResetContext,
  clearEntities,
  mergeEntitiesForStore,
} from '../utils/assistant-flow';
import type { AssistantParsedResponse } from '../utils/assistant-response-parser';
import { AssistantAvailabilityService } from './assistant-availability.service';
import { buildPendingBookingSummary } from '../helpers/assistant-summary-builder';

@Injectable()
export class AssistantContextService {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly appointmentsService: AppointmentsService,
    private readonly assistantAvailabilityService: AssistantAvailabilityService,
  ) {}

  async updateConversationState(params: {
    conversationId: string;
    currentState: ConversationState;
  }): Promise<void> {
    const { conversationId, currentState } = params;
    await this.conversationsService.update(conversationId, { currentState });
  }

  async resetAfterBookingComplete(conversation: Conversation): Promise<void> {
    const resetContext = buildResetContext(conversation);
    await this.conversationsService.update(conversation.id, {
      currentState: ConversationState.IDLE,
      contextJson: resetContext,
    });
    conversation.currentState = ConversationState.IDLE;
    conversation.contextJson = resetContext;
  }

  async buildLastAppointmentSummary(params: {
    tenantId: string;
    appointmentId: string;
    timezone: string;
  }): Promise<string | undefined> {
    const { tenantId, appointmentId, timezone } = params;
    const appointment = await this.appointmentsService.findOneByTenant(
      appointmentId,
      tenantId,
    );
    if (!appointment) return undefined;

    const serviceNames = Array.isArray(appointment.services)
      ? appointment.services
          .map((s) => s.service?.name)
          .filter((name): name is string => typeof name === 'string')
      : [];

    const staffNames = Array.isArray(appointment.services)
      ? appointment.services
          .map((s) => s.staff?.name)
          .filter((name): name is string => typeof name === 'string')
      : [];

    const staffLabel =
      staffNames.length > 0
        ? Array.from(new Set(staffNames)).join(', ')
        : 'sin preferencia';

    const startTime =
      appointment.startTime instanceof Date
        ? appointment.startTime
        : new Date(appointment.startTime as unknown as string);

    const formatted = startTime.toLocaleString('es-CO', {
      timeZone: timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    return `Resumen de tu cita:\n- Servicio: ${
      serviceNames.length > 0 ? serviceNames.join(', ') : 'No definido'
    }\n- Barbero: ${staffLabel}\n- Fecha y hora: ${formatted}`;
  }

  async mergeEntitiesForStore(params: {
    conversation: Conversation;
    finalEntities: AssistantParsedResponse['entities'] | undefined;
    entities: AssistantParsedResponse['entities'] | undefined;
  }): Promise<AssistantEntities> {
    const { conversation, finalEntities, entities } = params;
    const stored = (conversation.contextJson?.entities ??
      {}) as Partial<AssistantEntities>;
    const mergedEntities: AssistantEntities = mergeEntitiesForStore(
      finalEntities,
      entities,
      stored,
    );
    await this.conversationsService.update(conversation.id, {
      contextJson: {
        ...conversation.contextJson,
        entities: mergedEntities,
      },
    });
    return mergedEntities;
  }

  async markAssistantIntroduced(conversation: Conversation): Promise<void> {
    if (conversation.contextJson?.hasAssistantIntroduced === true) return;
    const nextContext = {
      ...(conversation.contextJson ?? {}),
      hasAssistantIntroduced: true,
    };
    await this.conversationsService.update(conversation.id, {
      contextJson: nextContext,
    });
    conversation.contextJson = nextContext;
  }

  async markWantsShowHours(conversation: Conversation): Promise<void> {
    const nextContext = {
      ...(conversation.contextJson ?? {}),
      wantsShowHours: true,
    };
    await this.conversationsService.update(conversation.id, {
      contextJson: nextContext,
    });
    conversation.contextJson = nextContext;
  }

  async clearWantsShowHours(conversation: Conversation): Promise<void> {
    if (conversation.contextJson?.wantsShowHours !== true) return;
    const nextContext = {
      ...(conversation.contextJson ?? {}),
      wantsShowHours: false,
    };
    await this.conversationsService.update(conversation.id, {
      contextJson: nextContext,
    });
    conversation.contextJson = nextContext;
  }

  async markWantsShowStaff(conversation: Conversation): Promise<void> {
    const nextContext = {
      ...(conversation.contextJson ?? {}),
      wantsShowStaff: true,
    };
    await this.conversationsService.update(conversation.id, {
      contextJson: nextContext,
    });
    conversation.contextJson = nextContext;
  }

  async clearWantsShowStaff(conversation: Conversation): Promise<void> {
    if (conversation.contextJson?.wantsShowStaff !== true) return;
    const nextContext = {
      ...(conversation.contextJson ?? {}),
      wantsShowStaff: false,
    };
    await this.conversationsService.update(conversation.id, {
      contextJson: nextContext,
    });
    conversation.contextJson = nextContext;
  }

  async resolveBookingData(params: {
    tenantId: string;
    availabilityResult: {
      bookingData?: {
        serviceIds: string[];
        staffId?: string;
        date: string;
        time: string;
      };
      isAvailable?: boolean;
    };
    mergedEntities: AssistantEntities;
  }): Promise<
    | {
        serviceIds: string[];
        staffId?: string;
        date: string;
        time: string;
      }
    | undefined
  > {
    const { tenantId, availabilityResult, mergedEntities } = params;

    // Calcular bookingData una sola vez para evitar duplicación
    let bookingData:
      | {
          serviceIds: string[];
          staffId?: string;
          date: string;
          time: string;
        }
      | undefined;

    if (availabilityResult.bookingData) {
      bookingData = availabilityResult.bookingData;
    } else if (availabilityResult.isAvailable === true) {
      bookingData = await this.assistantAvailabilityService.resolveBookingData({
        tenantId,
        entities: mergedEntities,
      });
    }

    return bookingData;
  }

  async applyPostAvailabilityFlow(params: {
    tenantId: string;
    conversation: Conversation;
    client: Client;
    availabilityResult: {
      isAvailable?: boolean;
    };
    finalAction: string | undefined;
    mergedEntities: AssistantEntities;
    bookingData:
      | {
          serviceIds: string[];
          staffId?: string;
          date: string;
          time: string;
        }
      | undefined;
    finalReply: string;
  }): Promise<{
    finalReply: string;
    entities: AssistantEntities | Partial<AssistantEntities>;
    action: string | undefined;
  }> {
    const {
      tenantId,
      conversation,
      client,
      availabilityResult,
      finalAction,
      mergedEntities,
      bookingData,
      finalReply,
    } = params;

    let nextFinalReply = finalReply;
    let nextEntities: AssistantEntities | Partial<AssistantEntities> =
      mergedEntities;
    let nextAction: string | undefined = finalAction;

    const hasAllData = Boolean(
      Array.isArray(mergedEntities.services) &&
      mergedEntities.services.length > 0 &&
      typeof mergedEntities.date === 'string' &&
      mergedEntities.date.trim().length > 0 &&
      typeof mergedEntities.time === 'string' &&
      mergedEntities.time.trim().length > 0 &&
      typeof mergedEntities.staff === 'string' &&
      mergedEntities.staff.trim().length > 0,
    );

    const pending = conversation.contextJson?.pendingBooking as
      | {
          serviceIds?: string[];
          staffId?: string;
          date?: string;
          time?: string;
        }
      | undefined;

    const nextBookingKey =
      bookingData &&
      [
        bookingData.serviceIds.slice().sort().join('|'),
        bookingData.staffId ?? '',
        bookingData.date,
        bookingData.time,
      ].join('::');

    const pendingBookingKey = pending
      ? [
          (pending.serviceIds ?? []).slice().sort().join('|'),
          pending.staffId ?? '',
          pending.date ?? '',
          pending.time ?? '',
        ].join('::')
      : undefined;

    const shouldUpdateSummary = Boolean(
      conversation.currentState !== ConversationState.BOOKING_COMPLETE &&
      !conversation.contextJson?.appointmentCreated &&
      nextBookingKey &&
      nextBookingKey !== pendingBookingKey,
    );

    if (
      availabilityResult.isAvailable === true &&
      hasAllData &&
      shouldUpdateSummary
    ) {
      if (bookingData) {
        await this.conversationsService.update(conversation.id, {
          currentState: ConversationState.CONFIRM_APPOINTMENT,
          contextJson: {
            ...(conversation.contextJson ?? {}),
            entities: mergedEntities,
            pendingBooking: {
              serviceIds: bookingData.serviceIds,
              staffId: bookingData.staffId,
              date: bookingData.date,
              time: bookingData.time,
            },
          },
        });
        nextFinalReply = buildPendingBookingSummary({
          services: mergedEntities.services ?? [],
          staff: mergedEntities.staff ?? null,
          date: bookingData.date,
          time: bookingData.time,
        });
        nextAction = undefined;
      }
    } else if (availabilityResult.isAvailable === false) {
      // When availability is false, use the availabilitySystemContent response
    }

    if (
      finalAction === 'CONFIRM_BOOKING' &&
      availabilityResult.isAvailable === true
    ) {
      // Usar el bookingData ya calculado arriba para evitar duplicación
      const appointmentKey = bookingData
        ? [
            bookingData.serviceIds.slice().sort().join('|'),
            bookingData.staffId ?? '',
            bookingData.date,
            bookingData.time,
          ].join('::')
        : undefined;
      const lastAppointmentKey =
        typeof conversation.contextJson?.lastAppointmentKey === 'string'
          ? conversation.contextJson.lastAppointmentKey
          : undefined;
      if (appointmentKey && lastAppointmentKey === appointmentKey) {
        nextFinalReply =
          'Tu cita ya está confirmada. Si necesitas otra, inicia un nuevo agendamiento.';
      } else if (!conversation.contextJson?.appointmentCreated) {
        if (bookingData) {
          const createdAppointment =
            await this.appointmentsService.createFromAssistant({
              tenantId,
              clientId: client.id,
              serviceIds: bookingData.serviceIds,
              staffId: bookingData.staffId,
              date: bookingData.date,
              time: bookingData.time,
            });

          const clearedEntities = clearEntities(
            conversation.contextJson?.entities as
              | Partial<AssistantEntities>
              | undefined,
          );
          // Reset completo del contexto después de confirmar
          const resetContext = {
            appointmentCreated: true,
            appointmentId: createdAppointment.id,
            lastAppointmentKey: appointmentKey,
            lastBookedEntities: {
              services: mergedEntities.services ?? null,
              staff: mergedEntities.staff ?? null,
              date: bookingData.date,
              time: bookingData.time,
            },
            entities: clearedEntities,
            pendingBooking: undefined, // Limpiar también pendingBooking
          };
          await this.conversationsService.update(conversation.id, {
            currentState: ConversationState.BOOKING_COMPLETE,
            contextJson: resetContext,
          });
          // Sincronizar estado local con el estado guardado
          conversation.currentState = ConversationState.BOOKING_COMPLETE;
          conversation.contextJson = resetContext;
          // Actualizar variables locales para evitar confusiones
          nextEntities = clearedEntities;
          nextAction = undefined;
          const dateTime = new Date(`${bookingData.date}T${bookingData.time}`);

          const formatted = dateTime.toLocaleString('es-CO', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          });

          // Actualizar finalReply y variables para el resto del flujo
          nextFinalReply = `¡Listo! Tu cita quedó agendada para el ${formatted}.`;
        }
      } else {
        nextFinalReply =
          'Tu cita ya está confirmada. Si necesitas otra, inicia un nuevo agendamiento.';
      }
    }

    // Mantener el estado de conversación sincronizado con la próxima acción
    // para que el router pueda usar shortcuts (p.ej. detectar selección de servicio/barbero).
    if (nextAction === 'ASK_SERVICE') {
      await this.conversationsService.update(conversation.id, {
        currentState: ConversationState.ASK_SERVICE,
        contextJson: {
          ...(conversation.contextJson ?? {}),
          entities: mergedEntities,
        },
      });
      conversation.currentState = ConversationState.ASK_SERVICE;
    }

    if (nextAction === 'ASK_STAFF') {
      await this.conversationsService.update(conversation.id, {
        currentState: ConversationState.ASK_STAFF,
        contextJson: {
          ...(conversation.contextJson ?? {}),
          entities: mergedEntities,
        },
      });
      conversation.currentState = ConversationState.ASK_STAFF;
    }

    return {
      finalReply: nextFinalReply,
      entities: nextEntities,
      action: nextAction,
    };
  }
}
