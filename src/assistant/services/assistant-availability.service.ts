import { Injectable } from '@nestjs/common';
import { AvailabilityService } from '../../availability/availability.service';
import { ServicesService } from '../../services/services.service';
import { StaffService } from '../../staff/staff.service';
import { buildAssistantSystemPrompt } from '../prompts/assistant.system';
import { parseAssistantResponse } from '../utils/assistant-response-parser';
import type { AssistantParsedResponse } from '../utils/assistant-response-parser';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { AIService } from '../../ai/ai.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { ConversationState } from '../../conversations/entities/conversation.entity';
import type { AssistantPromptContext } from '../prompts/assistant.system';
import type { Conversation } from '../../conversations/entities/conversation.entity';
import type { AssistantChatDto } from '../dto/assistant-chat.dto';
import {
  buildAvailabilityKey,
  hasAvailabilityEntities,
  mapServices,
  mapStaff,
} from './availability/availability-helpers';

@Injectable()
export class AssistantAvailabilityService {
  constructor(
    private readonly availabilityService: AvailabilityService,
    private readonly servicesService: ServicesService,
    private readonly staffService: StaffService,
    private readonly aiService: AIService,
    private readonly conversationsService: ConversationsService,
  ) {}

  async handleAvailability(params: {
    input: AssistantChatDto;
    conversation: Conversation;
    historyMessages: ChatCompletionMessageParam[];
    promptContext: AssistantPromptContext;
    reply: string;
    entities: AssistantParsedResponse['entities'] | undefined;
    action: string | undefined;
  }): Promise<{
    handled: boolean;
    finalReply: string;
    finalEntities?: AssistantParsedResponse['entities'];
    finalAction?: string;
    bookingData?: {
      serviceIds: string[];
      staffId?: string;
      date: string;
      time: string;
    };
    isAvailable?: boolean;
  }> {
    const {
      input,
      conversation,
      historyMessages,
      promptContext,
      reply,
      entities,
      action,
    } = params;

    if (conversation.currentState === ConversationState.BOOKING_COMPLETE) {
      return {
        handled: false,
        finalReply: reply,
        finalEntities: entities || {},
        finalAction: action || undefined,
      };
    }

    // Para SHOW_HOURS, no se requiere hora específica
    if (
      action === 'SHOW_HOURS' &&
      entities &&
      entities.services &&
      entities.date
    ) {
      // Continuar con el flujo normal aunque no haya hora
    } else if (!hasAvailabilityEntities(entities)) {
      return {
        handled: false,
        finalReply: reply,
        finalEntities: entities || {},
        finalAction: action || undefined,
      };
    }

    const serviceIds = await mapServices(
      entities.services || [],
      input.tenantId,
      this.servicesService,
    );
    const staffId = await mapStaff(
      entities.staff ?? null,
      input.tenantId,
      this.staffService,
    );

    if (serviceIds.length === 0) {
      return {
        handled: false,
        finalReply: reply,
        finalEntities: entities || {},
        finalAction: action || undefined,
      };
    }

    const availabilityKey = buildAvailabilityKey(
      serviceIds,
      staffId,
      entities.date || '',
      entities.time || '',
    );
    const currentContext = conversation.contextJson ?? {};
    const lastKey =
      typeof currentContext.lastAvailabilityKey === 'string'
        ? currentContext.lastAvailabilityKey
        : undefined;
    const lastIsAvailable =
      typeof currentContext.lastAvailabilityIsAvailable === 'boolean'
        ? currentContext.lastAvailabilityIsAvailable
        : undefined;

    if (action === 'SHOW_HOURS') {
      // Continuar al flujo normal para mostrar horarios
    } else if (lastKey === availabilityKey) {
      await this.conversationsService.update(conversation.id, {
        contextJson: {
          ...currentContext,
          lastAvailabilityKey: availabilityKey,
        },
      });
      return {
        handled: true,
        finalReply: reply,
        finalEntities: entities || {},
        finalAction: action || undefined,
        bookingData: {
          serviceIds,
          staffId,
          date: entities.date || '',
          time: entities.time || '',
        },
        isAvailable: lastIsAvailable,
      };
    }

    try {
      const availability = await this.availabilityService.findAvailableSlots({
        tenantId: input.tenantId,
        serviceIds,
        desiredDate: entities.date || '',
        desiredTime: entities.time || '',
        staffId,
      });

      const friendly: {
        isAvailable: boolean;
        friendlySlots: string[];
      } = await this.availabilityService.getFriendlySlotsFromAvailability(
        availability,
        input.tenantId,
      );

      const requestedTimeAvailable: boolean = friendly.friendlySlots.includes(
        entities.time || '',
      );
      const hasAvailability: boolean =
        availability.isAvailable && friendly.friendlySlots.length > 0;

      if (
        action === 'SHOW_HOURS' &&
        hasAvailability &&
        requestedTimeAvailable
      ) {
        const summary = `Resumen de tu cita:
          - Servicio: ${entities.services?.join(', ') ?? 'No definido'}
          - Barbero: ${entities.staff ?? 'Sin preferencia'}
          - Fecha: ${entities.date || 'No definida'}
          - Hora: ${entities.time || 'No definida'}
          ¿Deseas confirmar la cita?`;
        await this.conversationsService.update(conversation.id, {
          currentState: ConversationState.CONFIRM_APPOINTMENT,
          contextJson: {
            ...currentContext,
            lastAvailabilityKey: availabilityKey,
            lastAvailabilityIsAvailable: true,
          },
        });
        return {
          handled: true,
          finalReply: summary,
          finalEntities: entities || {},
          finalAction: action || undefined,
          bookingData: {
            serviceIds,
            staffId,
            date: entities.date || '',
            time: entities.time || '',
          },
          isAvailable: true,
        };
      }

      if (hasAvailability && requestedTimeAvailable) {
        await this.conversationsService.update(conversation.id, {
          currentState: ConversationState.CONFIRM_APPOINTMENT,
          contextJson: {
            ...currentContext,
            lastAvailabilityKey: availabilityKey,
            lastAvailabilityIsAvailable: true,
          },
        });
        return {
          handled: true,
          finalReply: reply,
          finalEntities: entities,
          finalAction: action,
          bookingData: {
            serviceIds,
            staffId,
            date: entities.date || '',
            time: entities.time || '',
          },
          isAvailable: true,
        };
      }

      const availabilitySystemContent = `
        NO HAY DISPONIBILIDAD - Ejecutando código IA secundario
        
        Resultado de disponibilidad:
        ${JSON.stringify({
          isAvailable: availability.isAvailable,
          friendlySlots: friendly.friendlySlots,
          action,
        } as unknown)}
        
        Instrucciones:
        
        - Si action es SHOW_HOURS:
          Muestra directamente horarios disponibles usando friendlySlots.
          Si hay staff específico, menciona el nombre del barbero.
          Usa este formato:
          "Estos son algunos horarios disponibles con [nombre del barbero]:
          - HH:mm
          - HH:mm
          ¿Cuál te sirve?"
        
        - Para cualquier otro caso:
          Muestra horarios alternativos usando friendlySlots.
          Si hay staff específico, menciona el nombre del barbero.
          Usa este formato:
          "No tengo disponibilidad a esa hora con [nombre del barbero], pero te propongo estos horarios disponibles:
          - HH:mm
          - HH:mm
          - HH:mm
          ¿Cuál te queda mejor o quieres intentar otra hora?"
        
        - Usa SOLO friendlySlots
        - NO inventes horarios
        - Usa un tono natural tipo WhatsApp
        `.trim();

      const availabilityResponse = await this.aiService.chat([
        { role: 'system', content: buildAssistantSystemPrompt(promptContext) },
        ...historyMessages,
        { role: 'system', content: availabilitySystemContent },
      ]);

      const parsedFinal = parseAssistantResponse(availabilityResponse);
      const mergedEntities = entities;
      const finalReply = parsedFinal.reply;

      await this.conversationsService.update(conversation.id, {
        currentState: ConversationState.SUGGEST_SLOTS,
        contextJson: {
          ...currentContext,
          lastAvailabilityKey: availabilityKey,
          lastAvailabilityIsAvailable: false,
        },
      });

      return {
        handled: true,
        finalReply,
        finalEntities: mergedEntities,
        finalAction: action,
        bookingData: {
          serviceIds,
          staffId,
          date: entities.date || '',
          time: entities.time || '',
        },
        isAvailable: false,
      };
    } catch (error) {
      console.error('Error handling availability:', error);
      return {
        handled: false,
        finalReply:
          'Hubo un problema al verificar la disponibilidad. Por favor, intenta nuevamente.',
        finalEntities: entities,
        finalAction: action,
      };
    }
  }

  async handleShowHours(params: {
    input: AssistantChatDto;
    conversation: Conversation;
    historyMessages: ChatCompletionMessageParam[];
    promptContext: AssistantPromptContext;
    reply: string;
    entities: AssistantParsedResponse['entities'] | undefined;
    action: string | undefined;
  }): Promise<{
    handled: boolean;
    finalReply: string;
    finalEntities?: AssistantParsedResponse['entities'];
    finalAction?: string | null;
  }> {
    const { reply, entities, action } = params;

    if (action !== 'SHOW_HOURS') {
      return {
        handled: false,
        finalReply: reply,
        finalEntities: entities || {},
        finalAction: action || undefined,
      };
    }

    return this.handleAvailability({
      ...params,
      entities,
    });
  }

  async resolveBookingData(params: {
    tenantId: string;
    entities: AssistantParsedResponse['entities'] | undefined;
  }): Promise<
    | {
        serviceIds: string[];
        staffId?: string;
        date: string;
        time: string;
      }
    | undefined
  > {
    const { tenantId, entities } = params;
    if (!hasAvailabilityEntities(entities)) return undefined;
    const serviceIds = await mapServices(
      entities.services,
      tenantId,
      this.servicesService,
    );
    const staffId = await mapStaff(
      entities.staff ?? null,
      tenantId,
      this.staffService,
    );
    if (serviceIds.length === 0) return undefined;
    return {
      serviceIds,
      staffId,
      date: entities.date,
      time: entities.time,
    };
  }
}
