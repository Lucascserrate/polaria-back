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
import { parseAssistantResponse } from './utils/assistant-response-parser';
import { AssistantAvailabilityService } from './services/assistant-availability.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { AssistantEntities } from './types/assistant-entities.type';

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
    let finalReply = reply;
    const availabilityResult =
      await this.assistantAvailabilityService.handleAvailability({
        input,
        conversation,
        historyMessages,
        promptContext,
        reply,
        entities,
        action,
      });
    if (availabilityResult.handled) {
      finalReply = availabilityResult.finalReply;
    }

    const finalAction = availabilityResult.finalAction ?? action;
    const finalEntities = availabilityResult.finalEntities ?? entities;
    const stored = (conversation.contextJson?.entities ??
      {}) as Partial<AssistantEntities>;
    const prev = entities ?? {};
    const next = finalEntities ?? {};

    const mergedEntities: AssistantEntities = {
      services: next.services ?? prev.services ?? stored.services ?? null,
      staff: next.staff ?? prev.staff ?? stored.staff ?? null,
      date: next.date ?? prev.date ?? stored.date ?? null,
      time: next.time ?? prev.time ?? stored.time ?? null,
    };

    await this.conversationsService.update(conversation.id, {
      contextJson: {
        ...conversation.contextJson,
        entities: mergedEntities,
      },
    });

    if (
      finalAction === 'CONFIRM_BOOKING' &&
      availabilityResult.isAvailable !== false
    ) {
      const bookingData =
        availabilityResult.bookingData ??
        (await this.assistantAvailabilityService.resolveBookingData({
          tenantId: input.tenantId,
          entities: mergedEntities,
        }));
      if (bookingData) {
        await this.appointmentsService.createFromAssistant({
          tenantId: input.tenantId,
          clientId: client.id,
          serviceIds: bookingData.serviceIds,
          staffId: bookingData.staffId,
          date: bookingData.date,
          time: bookingData.time,
        });
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
