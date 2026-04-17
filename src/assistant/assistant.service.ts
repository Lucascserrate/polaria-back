import { Injectable } from '@nestjs/common';
import { AIService } from '../ai/ai.service';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { MessageRole } from '../messages/entities/message.entity';
import { AssistantChatDto } from './dto/assistant-chat.dto';
import { AssistantSimpleDto } from './dto/assistant-simple.dto';
import { ClientsService } from '../clients/clients.service';
import { ConversationState } from '../conversations/entities/conversation.entity';
import type { Client } from '../clients/entities/client.entity';
import type { Conversation } from '../conversations/entities/conversation.entity';
import { buildAssistantSystemPrompt } from './prompts/assistant.system';
import { AssistantPromptContextService } from './services/assistant-prompt-context.service';
import { buildTempName } from './utils/assistant-utils';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import {
  AssistantParsedResponse,
  parseAssistantResponse,
} from './utils/assistant-response-parser';
import { AssistantAvailabilityService } from './services/assistant-availability.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { AssistantEntities } from './types/assistant-entities.type';
import { clearEntities, mergeEntitiesForStore } from './utils/assistant-flow';
import { handleBookingContext } from './utils/booking-context.helper';

@Injectable()
export class AssistantService {
  constructor(
    private readonly aiService: AIService,
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly clientsService: ClientsService,
    private readonly promptContextService: AssistantPromptContextService,
    private readonly assistantAvailabilityService: AssistantAvailabilityService,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  async chat(
    input: AssistantChatDto,
  ): Promise<{ reply: string; conversationId: string; clientId: string }> {
    let client: Client | null = await this.clientsService.findByTenantAndPhone(
      input.tenantId,
      input.phone,
    );
    if (!client) {
      const tempName = buildTempName(input.phone);
      client = await this.clientsService.create({
        tenantId: input.tenantId,
        phone: input.phone,
        name: tempName,
      });
    }

    let conversation: Conversation | null =
      await this.conversationsService.findByTenantAndClient(
        input.tenantId,
        client.id,
      );
    if (!conversation) {
      conversation = await this.conversationsService.create({
        tenantId: input.tenantId,
        clientId: client.id,
        currentState: ConversationState.IDLE,
        contextJson: {},
      });
    }

    await this.messagesService.create({
      tenantId: input.tenantId,
      conversationId: conversation.id,
      clientId: client.id,
      role: MessageRole.USER,
      content: input.messageText,
    });

    const promptContext = await this.promptContextService.build(
      input.tenantId,
      client.name ?? undefined,
      conversation.currentState,
    );
    const history = await this.messagesService.findRecentByConversation(
      conversation.id,
      6,
    );
    const historyMessages: ChatCompletionMessageParam[] = history
      .slice()
      .reverse()
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    const response = await this.aiService.chat([
      { role: 'system', content: buildAssistantSystemPrompt(promptContext) },
      ...historyMessages,
    ]);

    let parsed = parseAssistantResponse(response);
    let reply = parsed.reply;
    let entities = parsed.entities;
    let action = parsed.action;

    if (!entities) {
      if (conversation.currentState === ConversationState.BOOKING_COMPLETE) {
        await this.messagesService.create({
          tenantId: input.tenantId,
          conversationId: conversation.id,
          clientId: client.id,
          role: MessageRole.ASSISTANT,
          content: reply,
          rawJson: response,
        });
        await this.conversationsService.update(conversation.id, {
          lastMessageAt: new Date(),
        });
        return {
          reply,
          conversationId: conversation.id,
          clientId: client.id,
        };
      }
      const correctionResponse = await this.aiService.chat([
        { role: 'system', content: buildAssistantSystemPrompt(promptContext) },
        ...historyMessages,
        {
          role: 'system',
          content:
            'Responde SOLO con JSON válido en el formato indicado. No incluyas texto adicional.',
        },
      ]);
      parsed = parseAssistantResponse(correctionResponse);
      reply = parsed.reply;
      entities = parsed.entities;
      action = parsed.action;
    }

    if (
      action === 'CONFIRM_BOOKING' &&
      (conversation.currentState !== ConversationState.CONFIRM_APPOINTMENT ||
        !conversation.contextJson?.pendingBooking)
    ) {
      action = undefined;
    }

    const normalizedMessage = input.messageText.trim().toLowerCase();
    const staffNames = Object.keys(promptContext.staffServices);
    if (staffNames.length > 0) {
      const staffMatch = staffNames.find(
        (name) => normalizedMessage === name.trim().toLowerCase(),
      );
      if (staffMatch) {
        entities = {
          ...(entities ?? {}),
          staff: staffMatch,
        };
      }
    }

    const bookingContext = await handleBookingContext({
      conversation,
      entities,
      action,
      reply,
      input,
      client,
      conversationsService: this.conversationsService,
      messagesService: this.messagesService,
    });

    if (bookingContext.handled) {
      return bookingContext.response;
    }

    entities = bookingContext.entities;
    action = bookingContext.action;
    const shouldShowHours = bookingContext.shouldShowHours;

    let finalReply = reply;
    if (shouldShowHours && action === 'SHOW_HOURS') {
      await this.conversationsService.update(conversation.id, {
        currentState: ConversationState.SUGGEST_SLOTS,
      });
      const showHoursResult: {
        handled: boolean;
        finalReply: string;
        finalEntities?: AssistantParsedResponse['entities'];
        finalAction?: string | null;
      } = await this.assistantAvailabilityService.handleShowHours({
        input,
        conversation,
        historyMessages,
        promptContext,
        reply,
        entities,
        action: 'SHOW_HOURS',
      });

      if (showHoursResult.handled) {
        finalReply = showHoursResult.finalReply;
        entities = showHoursResult.finalEntities ?? entities;
        action = showHoursResult.finalAction ?? action;
      }
    }

    let availabilityResult: {
      handled: boolean;
      finalReply: string;
      finalEntities: AssistantParsedResponse['entities'];
      finalAction: string | undefined;
      bookingData?: {
        serviceIds: string[];
        staffId?: string;
        date: string;
        time: string;
      };
      isAvailable?: boolean;
    } = {
      handled: false,
      finalReply: finalReply,
      finalEntities: entities ?? {},
      finalAction: action,
      isAvailable: undefined,
      bookingData: undefined,
    };
    if (!shouldShowHours && action !== null) {
      const availabilityResultRaw =
        await this.assistantAvailabilityService.handleAvailability({
          input,
          conversation,
          historyMessages,
          promptContext,
          reply: finalReply,
          entities,
          action,
        });
      availabilityResult = {
        ...availabilityResultRaw,
        finalEntities: availabilityResultRaw.finalEntities ?? entities ?? {},
        finalAction: availabilityResultRaw.finalAction ?? action,
      };
    }

    if (availabilityResult.handled) {
      finalReply = availabilityResult.finalReply;
    }

    const finalAction = availabilityResult.finalAction ?? action;
    const finalEntities = availabilityResult.finalEntities ?? entities;
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
        tenantId: input.tenantId,
        entities: mergedEntities,
      });
    }

    if (
      availabilityResult.isAvailable === true &&
      finalAction !== 'CONFIRM_BOOKING' &&
      conversation.currentState !== ConversationState.BOOKING_COMPLETE &&
      !conversation.contextJson?.appointmentCreated &&
      conversation.currentState !== ConversationState.CONFIRM_APPOINTMENT
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
        }\n- Barbero: ${mergedEntities.staff ?? 'Sin preferencia'}\n- Fecha: ${
          bookingData.date
        }\n- Hora: ${bookingData.time}\n¿Deseas confirmar la cita?`;

        // Si llegamos al resumen, significa que todo está disponible y confirmado
        finalReply = summary;
      }
    } else if (availabilityResult.isAvailable === false) {
      // When availability is false, use the availabilitySystemContent response
      finalReply = availabilityResult.finalReply;
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
        finalReply =
          'Tu cita ya está confirmada. Si necesitas otra, inicia un nuevo agendamiento.';
      } else if (!conversation.contextJson?.appointmentCreated) {
        if (bookingData) {
          await this.appointmentsService.createFromAssistant({
            tenantId: input.tenantId,
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
          entities = clearedEntities;
          action = undefined;
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
          finalReply = `¡Listo! Tu cita quedó agendada para el ${formatted}.`;
        }
      } else {
        finalReply =
          'Tu cita ya está confirmada. Si necesitas otra, inicia un nuevo agendamiento.';
      }
    }

    await this.messagesService.create({
      tenantId: input.tenantId,
      conversationId: conversation.id,
      clientId: client.id,
      role: MessageRole.ASSISTANT,
      content: finalReply,
      rawJson: response,
    });

    await this.conversationsService.update(conversation.id, {
      lastMessageAt: new Date(),
    });

    return {
      reply: finalReply,
      conversationId: conversation.id,
      clientId: client.id,
    };
  }

  async simpleChat(input: AssistantSimpleDto): Promise<{ reply: string }> {
    const promptContext = await this.promptContextService.build();
    const response = await this.aiService.chat([
      { role: 'system', content: buildAssistantSystemPrompt(promptContext) },
      { role: 'user', content: input.messageText },
    ]);

    const { reply } = parseAssistantResponse(response);
    return { reply };
  }
}
