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
  }): Promise<{ handled: boolean; finalReply: string }> {
    const {
      input,
      conversation,
      historyMessages,
      promptContext,
      reply,
      entities,
    } = params;

    if (!this.hasAvailabilityEntities(entities)) {
      return { handled: false, finalReply: reply };
    }

    const serviceIds = await this.mapServices(
      entities.services,
      input.tenantId,
    );
    const staffId = await this.mapStaff(entities.staff ?? null, input.tenantId);

    if (serviceIds.length === 0) {
      return { handled: false, finalReply: reply };
    }

    const availabilityKey = this.buildAvailabilityKey(
      serviceIds,
      staffId,
      entities.date,
      entities.time,
    );
    const currentContext = conversation.contextJson ?? {};
    const lastKey =
      typeof currentContext.lastAvailabilityKey === 'string'
        ? currentContext.lastAvailabilityKey
        : undefined;

    if (lastKey === availabilityKey) {
      return { handled: true, finalReply: reply };
    }

    const availability = await this.availabilityService.findAvailableSlots({
      tenantId: input.tenantId,
      serviceIds,
      desiredDate: entities.date,
      desiredTime: entities.time,
      staffId,
    });

    const availabilitySystemContent = `
      Resultado de disponibilidad:
        ${JSON.stringify(availability)}

        Instrucciones:
        - Si isAvailable es true -> confirma la cita de forma natural
        - Si isAvailable es false -> ofrece suggestedSlots
        - Usa staffName y horas reales
        - NO inventes horarios
        - Se claro y amigable
        - Manten el formato JSON obligatorio`;
    console.log(
      '[assistant] availability suggestedSlots:',
      availability.suggestedSlots,
    );

    const availabilityResponse = await this.aiService.chat([
      { role: 'system', content: buildAssistantSystemPrompt(promptContext) },
      ...historyMessages,
      { role: 'system', content: availabilitySystemContent },
    ]);

    const parsedFinal = parseAssistantResponse(availabilityResponse);

    await this.conversationsService.update(conversation.id, {
      currentState: availability.isAvailable
        ? ConversationState.CONFIRM_APPOINTMENT
        : ConversationState.SUGGEST_SLOTS,
      contextJson: {
        ...currentContext,
        lastAvailabilityKey: availabilityKey,
      },
    });

    return { handled: true, finalReply: parsedFinal.reply };
  }

  private async mapServices(
    names: string[],
    tenantId: string,
  ): Promise<string[]> {
    if (!names.length) return [];
    const services = await this.servicesService.findByTenant(tenantId);
    const normalized = names.map((name) => name.trim().toLowerCase());
    return services
      .filter((service) =>
        normalized.includes(service.name.trim().toLowerCase()),
      )
      .map((service) => service.id);
  }

  private async mapStaff(
    name: string | null,
    tenantId: string,
  ): Promise<string | undefined> {
    const normalized = name?.trim().toLowerCase();
    if (!normalized) return undefined;
    const noPreference = ['sin preferencia'];
    if (noPreference.includes(normalized)) return undefined;
    const staffList = await this.staffService.findByTenant(tenantId);
    const found = staffList.find(
      (staff) => staff.name.trim().toLowerCase() === normalized,
    );
    return found?.id;
  }

  private hasAvailabilityEntities(
    entities: AssistantParsedResponse['entities'] | undefined,
  ): entities is {
    services: string[];
    staff: string;
    date: string;
    time: string;
  } {
    if (!entities) return false;
    if (!Array.isArray(entities.services) || entities.services.length === 0) {
      return false;
    }
    if (typeof entities.date !== 'string' || entities.date.trim() === '') {
      return false;
    }
    if (typeof entities.time !== 'string' || entities.time.trim() === '') {
      return false;
    }
    if (typeof entities.staff !== 'string' || entities.staff.trim() === '') {
      return false;
    }
    return true;
  }

  private buildAvailabilityKey(
    serviceIds: string[],
    staffId: string | undefined,
    date: string,
    time: string,
  ): string {
    const sortedServices = [...serviceIds].sort().join('|');
    return [sortedServices, staffId ?? '', date, time].join('::');
  }
}
