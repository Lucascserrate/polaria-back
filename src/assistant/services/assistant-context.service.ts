import { Injectable } from '@nestjs/common';
import { AppointmentsService } from '../../appointments/appointments.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { ConversationState } from '../../conversations/entities/conversation.entity';
import type { Client } from '../../clients/entities/client.entity';
import type { Conversation } from '../../conversations/entities/conversation.entity';
import type { AssistantEntities } from '../types/assistant-entities.type';
import { clearEntities, mergeEntitiesForStore } from '../utils/assistant-flow';
import type { AssistantParsedResponse } from '../utils/assistant-response-parser';
import { AssistantAvailabilityService } from './assistant-availability.service';

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
        const summary = `Resumen de tu cita:\n- Servicio: ${
          mergedEntities.services?.join(', ') ?? 'No definido'
        }\n- Barbero: ${mergedEntities.staff ?? 'sin preferencia'}\n- Fecha: ${
          bookingData.date
        }\n- Hora: ${bookingData.time}\n¿Deseas confirmar la cita?`;

        nextFinalReply = summary;
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

    return {
      finalReply: nextFinalReply,
      entities: nextEntities,
      action: nextAction,
    };
  }
}
