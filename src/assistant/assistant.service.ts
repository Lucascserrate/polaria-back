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
import { normalizeAssistantEntities } from './core/assistant-normalizer';
import { decideNextAction } from './core/assistant-orchestrator';
import { AssistantAction } from './core/assistant-actions';
import { AssistantReplyEnricherService } from './services/assistant-reply-enricher.service';
import type { AssistantEntities } from './types/assistant-entities.type';
import { TenantsService } from '../tenants/tenants.service';

const AI_DISABLED_REPLY =
  'Hola, gracias por escribirnos. En este momento no tenemos atención al cliente disponible, pero te responderemos apenas estemos de vuelta.';

@Injectable()
export class AssistantService {
  constructor(
    private readonly assistantSessionService: AssistantSessionService,
    private readonly assistantMessagingService: AssistantMessagingService,
    private readonly assistantAIService: AssistantAIService,
    private readonly promptContextService: AssistantPromptContextService,
    private readonly assistantAvailabilityService: AssistantAvailabilityService,
    private readonly assistantContextService: AssistantContextService,
    private readonly assistantReplyEnricherService: AssistantReplyEnricherService,
    private readonly tenantsService: TenantsService,
  ) {}

  async chat(
    input: AssistantChatDto,
  ): Promise<{ reply: string; conversationId: string; clientId: string }> {
    const { client, conversation } =
      await this.assistantSessionService.getOrCreateSession({
        tenantId: input.tenantId,
        phone: input.phone,
        clientName: input.clientName,
      });

    const tenant = await this.tenantsService.findOne(input.tenantId);
    if (tenant && !tenant.aiEnabled) {
      await this.assistantMessagingService.saveUserMessage({
        tenantId: input.tenantId,
        conversationId: conversation.id,
        clientId: client.id,
        content: input.messageText,
      });
      await this.assistantMessagingService.saveAssistantMessage({
        tenantId: input.tenantId,
        conversationId: conversation.id,
        clientId: client.id,
        content: AI_DISABLED_REPLY,
        rawJson: { disabled: true },
      });
      await this.assistantMessagingService.touchConversationLastMessageAt(
        conversation.id,
      );
      return {
        reply: AI_DISABLED_REPLY,
        conversationId: conversation.id,
        clientId: client.id,
      };
    }

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

    if (conversation.currentState === ConversationState.BOOKING_COMPLETE) {
      if (parsed.action === 'CONFIRM_BOOKING') {
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

      const hasNewService = Boolean(
        Array.isArray(parsed.entities?.services) &&
        parsed.entities.services.length > 0,
      );

      if (!hasNewService) {
        if (
          parsed.action === 'RESUMEN' &&
          typeof conversation.contextJson?.appointmentId === 'string' &&
          conversation.contextJson.appointmentId.length > 0
        ) {
          const summary =
            await this.assistantContextService.buildLastAppointmentSummary({
              tenantId: input.tenantId,
              appointmentId: conversation.contextJson.appointmentId,
              timezone: promptContext.timezone,
            });
          if (summary) {
            await this.assistantMessagingService.saveAssistantMessage({
              tenantId: input.tenantId,
              conversationId: conversation.id,
              clientId: client.id,
              content: summary,
              rawJson: response,
            });
            await this.assistantMessagingService.touchConversationLastMessageAt(
              conversation.id,
            );
            return {
              reply: summary,
              conversationId: conversation.id,
              clientId: client.id,
            };
          }
        }

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

      await this.assistantContextService.resetAfterBookingComplete(
        conversation,
      );
    }

    const mergedEntities =
      await this.assistantContextService.mergeEntitiesForStore({
        conversation,
        finalEntities: parsed.entities,
        entities: parsed.entities,
      });

    const normalizedEntities = normalizeAssistantEntities({
      incoming: parsed.entities,
      stored: (conversation.contextJson?.entities ??
        mergedEntities) as Partial<AssistantEntities>,
      timezone: promptContext.timezone,
    });

    const finalAction: AssistantAction | undefined = decideNextAction({
      entities: normalizedEntities,
      proposedAction: parsed.action,
      conversationState: conversation.currentState,
    });

    await this.assistantContextService.mergeEntitiesForStore({
      conversation,
      finalEntities: normalizedEntities,
      entities: normalizedEntities,
    });

    const availabilityResult = finalAction
      ? await this.assistantAvailabilityService.handleAvailability({
          input,
          conversation,
          historyMessages,
          promptContext,
          reply: parsed.reply,
          entities: normalizedEntities,
          action: finalAction,
        })
      : {
          handled: false,
          finalReply: parsed.reply,
          finalEntities: normalizedEntities,
          finalAction: finalAction,
        };

    const finalReplyFromAvailability = availabilityResult.handled
      ? availabilityResult.finalReply
      : parsed.reply;

    const enrichedReply = await this.assistantReplyEnricherService.enrich({
      tenantId: input.tenantId,
      promptContext,
      historyMessages,
      baseReply: finalReplyFromAvailability,
      action: finalAction,
    });

    const entitiesToStore =
      availabilityResult.handled && availabilityResult.finalEntities
        ? availabilityResult.finalEntities
        : normalizedEntities;

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
        finalReply: enrichedReply,
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
