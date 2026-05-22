import { Injectable } from '@nestjs/common';
import { AvailabilityService } from '../../availability/availability.service';
import { ServicesService } from '../../services/services.service';
import { StaffService } from '../../staff/staff.service';
import { buildSlotsPrompt } from '../prompts/assistant.slots.prompt';
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

  private formatSlotsMessage(params: {
    friendlySlots: string[];
    mode: 'SHOW_HOURS' | 'ALTERNATIVES';
  }): string {
    const { friendlySlots, mode } = params;
    const lines = friendlySlots.map((s) => `- ${s}`).join('\n');

    if (mode === 'SHOW_HOURS') {
      return `Estos son algunos horarios disponibles:\n${lines}\n¿Cuál te sirve?`;
    }

    return `No tengo disponibilidad a esa hora, pero te propongo estos horarios disponibles:\n${lines}\n¿Cuál te queda mejor o quieres intentar otra hora?`;
  }

  private async generateSlotsReply(params: {
    historyMessages: ChatCompletionMessageParam[];
    friendlySlots: string[];
    mode: 'SHOW_HOURS' | 'ALTERNATIVES';
  }): Promise<string> {
    const { historyMessages, friendlySlots, mode } = params;

    try {
      const response = await this.aiService.chat([
        { role: 'system', content: buildSlotsPrompt({ friendlySlots }) },
        ...historyMessages,
      ]);

      const text = (response.content ?? '').trim();
      return text.length > 0
        ? text
        : this.formatSlotsMessage({ friendlySlots, mode });
    } catch {
      return this.formatSlotsMessage({ friendlySlots, mode });
    }
  }

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
    const { input, conversation, historyMessages, reply, entities, action } =
      params;

    if (conversation.currentState === ConversationState.BOOKING_COMPLETE) {
      return {
        handled: false,
        finalReply: reply,
        finalEntities: entities || {},
        finalAction: action || undefined,
      };
    }

    const isShowHours = action === 'SHOW_HOURS';

    if (!entities) {
      return {
        handled: false,
        finalReply: reply,
        finalEntities: {},
        finalAction: action || undefined,
      };
    }

    // Para SHOW_HOURS, no se requiere hora específica (solo servicio + fecha)
    if (isShowHours) {
      const hasServices =
        Array.isArray(entities.services) && entities.services.length > 0;
      const hasDate =
        typeof entities.date === 'string' && entities.date.length > 0;
      if (!hasServices || !hasDate) {
        return {
          handled: false,
          finalReply: reply,
          finalEntities: entities || {},
          finalAction: action || undefined,
        };
      }
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

    if (!isShowHours && lastKey === availabilityKey) {
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

      if (action === 'SHOW_HOURS' && hasAvailability) {
        const showReply = await this.generateSlotsReply({
          historyMessages,
          friendlySlots: friendly.friendlySlots,
          mode: 'SHOW_HOURS',
        });

        await this.conversationsService.update(conversation.id, {
          currentState: ConversationState.SUGGEST_SLOTS,
          contextJson: {
            ...currentContext,
            lastAvailabilityKey: availabilityKey,
            lastAvailabilityIsAvailable: true,
          },
        });

        return {
          handled: true,
          finalReply: showReply,
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

      const mergedEntities = entities;
      const finalReply = await this.generateSlotsReply({
        historyMessages,
        friendlySlots: friendly.friendlySlots,
        mode: 'ALTERNATIVES',
      });

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
