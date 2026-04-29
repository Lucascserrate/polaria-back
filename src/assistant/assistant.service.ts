import { Injectable } from '@nestjs/common';
import { ConversationState } from '../conversations/entities/conversation.entity';
import { AssistantChatDto } from './dto/assistant-chat.dto';
import { AssistantSimpleDto } from './dto/assistant-simple.dto';
import { AssistantAIService } from './services/assistant-ai.service';
import { AssistantAvailabilityService } from './services/assistant-availability.service';
import { AssistantContextService } from './services/assistant-context.service';
import { AssistantMessagingService } from './services/assistant-messaging.service';
import { AssistantPromptContextService } from './services/assistant-prompt-context.service';
import { AssistantSessionService } from './services/assistant-session.service';

@Injectable()
export class AssistantService {
  constructor(
    private readonly assistantSessionService: AssistantSessionService,
    private readonly assistantMessagingService: AssistantMessagingService,
    private readonly assistantAIService: AssistantAIService,
    private readonly promptContextService: AssistantPromptContextService,
    private readonly assistantAvailabilityService: AssistantAvailabilityService,
    private readonly assistantContextService: AssistantContextService,
  ) {}

  async chat(
    input: AssistantChatDto,
  ): Promise<{ reply: string; conversationId: string; clientId: string }> {
    const { client, conversation } =
      await this.assistantSessionService.getOrCreateSession({
        tenantId: input.tenantId,
        phone: input.phone,
      });

    await this.assistantMessagingService.saveUserMessage({
      tenantId: input.tenantId,
      conversationId: conversation.id,
      clientId: client.id,
      content: input.messageText,
    });
    await this.assistantMessagingService.touchConversationLastMessageAt(
      conversation.id,
    );

    const storedEntitiesJson = JSON.stringify(
      conversation.contextJson?.entities ?? null,
    );
    const promptContext = await this.promptContextService.build(
      input.tenantId,
      client.name ?? undefined,
      conversation.currentState,
      storedEntitiesJson,
    );
    const historyMessages =
      await this.assistantMessagingService.getConversationHistory({
        conversationId: conversation.id,
        limit: 6,
      });

    const { response, parsed: firstParsed } =
      await this.assistantAIService.executeChat({
        promptContext,
        historyMessages,
      });

    let parsed = firstParsed;

    if (!parsed.entities) {
      if (conversation.currentState === ConversationState.BOOKING_COMPLETE) {
        await this.assistantMessagingService.saveAssistantMessage({
          tenantId: input.tenantId,
          conversationId: conversation.id,
          clientId: client.id,
          content: parsed.reply,
          rawJson: response,
        });
        await this.assistantMessagingService.touchConversationLastMessageAt(
          conversation.id,
        );
        return {
          reply: parsed.reply,
          conversationId: conversation.id,
          clientId: client.id,
        };
      }

      const retry = await this.assistantAIService.retryWhenEntitiesMissing({
        promptContext,
        historyMessages,
      });
      parsed = retry.parsed;
    }

    const mergedEntities =
      await this.assistantContextService.mergeEntitiesForStore({
        conversation,
        finalEntities: parsed.entities,
        entities: parsed.entities,
      });

    const availabilityResult =
      await this.assistantAvailabilityService.handleAvailability({
        input,
        conversation,
        historyMessages,
        promptContext,
        reply: parsed.reply,
        entities: mergedEntities,
        action: parsed.action,
      });

    const finalReplyFromAvailability = availabilityResult.handled
      ? availabilityResult.finalReply
      : parsed.reply;

    const entitiesToStore =
      availabilityResult.handled && availabilityResult.finalEntities
        ? availabilityResult.finalEntities
        : parsed.entities;

    const mergedAfterAvailability =
      await this.assistantContextService.mergeEntitiesForStore({
        conversation,
        finalEntities: entitiesToStore,
        entities: entitiesToStore,
      });

    const bookingData = await this.assistantContextService.resolveBookingData({
      tenantId: input.tenantId,
      availabilityResult,
      mergedEntities: mergedAfterAvailability,
    });

    const postFlow =
      await this.assistantContextService.applyPostAvailabilityFlow({
        tenantId: input.tenantId,
        conversation,
        client,
        availabilityResult,
        finalAction: availabilityResult.finalAction,
        mergedEntities: mergedAfterAvailability,
        bookingData,
        finalReply: finalReplyFromAvailability,
      });

    await this.assistantMessagingService.saveAssistantMessage({
      tenantId: input.tenantId,
      conversationId: conversation.id,
      clientId: client.id,
      content: postFlow.finalReply,
      rawJson: response,
    });
    await this.assistantMessagingService.touchConversationLastMessageAt(
      conversation.id,
    );

    return {
      reply: postFlow.finalReply,
      conversationId: conversation.id,
      clientId: client.id,
    };
  }

  simpleChat(input: AssistantSimpleDto) {
    void input;
    throw new Error(
      'simpleChat no está soportado: se requiere tenantId para construir el prompt.',
    );
  }
}
