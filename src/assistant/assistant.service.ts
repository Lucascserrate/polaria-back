import { Injectable, Logger } from '@nestjs/common';

import { detectBookingTrigger } from '../booking-flow/booking-trigger';
import { TenantsService } from '../tenants/tenants.service';
import { AssistantChatDto } from './dto/assistant-chat.dto';
import { AssistantSimpleDto } from './dto/assistant-simple.dto';
import { resolvePromptForIntent } from './helpers/assistant-prompt-resolver';
import { AssistantIntent } from './intents/assistant-intent';
import { AssistantAIService } from './services/assistant-ai.service';
import { AssistantContextService } from './services/assistant-context.service';
import { AssistantIntentRouterService } from './services/assistant-intent-router.service';
import { AssistantMessagingService } from './services/assistant-messaging.service';
import { AssistantPromptContextService } from './services/assistant-prompt-context.service';
import { AssistantReplyEnricherService } from './services/assistant-reply-enricher.service';
import { AssistantSessionService } from './services/assistant-session.service';

/**
 * Respuesta cuando el tenant tiene la IA apagada.
 *
 * Menciona la reserva a propósito: con la IA apagada el flujo guiado **sigue
 * funcionando**, porque no depende de ella. Apagar la IA silencia la
 * conversación, no la agenda.
 */
const AI_DISABLED_REPLY =
  'Gracias por escribirnos. En este momento no tenemos atención al cliente disponible, pero puedes agendar tu turno igual: escríbeme "reservar" y lo hacemos.';

const NO_APPOINTMENT_REPLY =
  'No encuentro ninguna cita agendada a tu nombre. Si quieres reservar una, escríbeme y la agendamos.';

/**
 * Intenciones que significan "quiero un turno".
 *
 * Todas derivan en lo mismo: ceder el control al flujo guiado. La IA no redacta
 * ninguna respuesta en estos casos, ni siquiera para pedir un dato.
 */
const BOOKING_INTENTS: readonly AssistantIntent[] = [
  AssistantIntent.BOOKING,
  AssistantIntent.SHOW_HOURS,
  AssistantIntent.CONFIRM_BOOKING,
];

export type AssistantChatResult = {
  reply: string;
  conversationId: string;
  clientId: string;
  /**
   * La IA detectó que el usuario quiere reservar. El llamador debe iniciar el
   * flujo guiado; `reply` viene vacío porque la IA no responde en ese caso.
   */
  wantsBooking: boolean;
};

/**
 * Asistente conversacional.
 *
 * Su alcance es deliberadamente estrecho: conversar, responder preguntas sobre el
 * negocio y **detectar** la intención de reservar. No recopila datos de una
 * reserva, no consulta disponibilidad y no crea ni modifica citas. Todo eso vive
 * en el flujo guiado, que solo acepta datos provenientes de componentes
 * interactivos.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly assistantSessionService: AssistantSessionService,
    private readonly assistantMessagingService: AssistantMessagingService,
    private readonly assistantAIService: AssistantAIService,
    private readonly promptContextService: AssistantPromptContextService,
    private readonly assistantIntentRouterService: AssistantIntentRouterService,
    private readonly assistantContextService: AssistantContextService,
    private readonly assistantReplyEnricherService: AssistantReplyEnricherService,
    private readonly tenantsService: TenantsService,
  ) {}

  async chat(input: AssistantChatDto): Promise<AssistantChatResult> {
    const { client, conversation } =
      await this.assistantSessionService.getOrCreateSession({
        tenantId: input.tenantId,
        phone: input.phone,
        clientName: input.clientName,
      });

    const base = { conversationId: conversation.id, clientId: client.id };

    // El mensaje del usuario se guarda siempre, incluso con la IA apagada: es el
    // registro de la conversación que ve la barbería en el panel.
    await this.assistantMessagingService.saveUserMessage({
      tenantId: input.tenantId,
      conversationId: conversation.id,
      clientId: client.id,
      content: input.messageText,
    });
    await this.assistantMessagingService.touchConversationLastMessageAt(
      conversation.id,
    );

    const tenant = await this.tenantsService.findOne(input.tenantId);
    if (tenant && !tenant.aiEnabled) {
      // El router de intención es una llamada a la IA, así que acá no está
      // disponible. Pero reservar no puede depender de la IA: se cae al
      // disparador por palabras clave, que es determinista.
      if (detectBookingTrigger(input.messageText)) {
        this.logger.log(
          `Intención de reserva detectada sin IA (tenantId=${input.tenantId}, clientId=${client.id}).`,
        );
        return { ...base, reply: '', wantsBooking: true };
      }

      await this.record({
        input,
        conversation,
        client,
        reply: AI_DISABLED_REPLY,
        rawJson: { disabled: true },
      });
      return { ...base, reply: AI_DISABLED_REPLY, wantsBooking: false };
    }

    const promptContext = await this.promptContextService.build(
      input.tenantId,
      client.name ?? undefined,
    );

    const routerResult = await this.assistantIntentRouterService.routeIntent({
      messageText: input.messageText,
      services: promptContext.services,
      businessHours: promptContext.businessHours,
      businessDaysOpen: promptContext.businessDaysOpen ?? [],
      staffNames: Object.keys(promptContext.staffServices),
      currentDate: promptContext.currentDate,
    });

    // Intención de reservar: la IA se aparta. No se llama al modelo para redactar
    // nada, así que no tiene ocasión de inventar horarios ni de dar por sentado un
    // servicio a partir del texto.
    if (BOOKING_INTENTS.includes(routerResult.intent)) {
      this.logger.log(
        `Intención de reserva detectada (tenantId=${input.tenantId}, clientId=${client.id}, intent=${routerResult.intent}).`,
      );
      return { ...base, reply: '', wantsBooking: true };
    }

    // Pregunta por una cita existente: se responde con la cita real de la base.
    if (routerResult.intent === AssistantIntent.SUMMARY) {
      const summary =
        (await this.assistantContextService.buildLastAppointmentSummary({
          tenantId: input.tenantId,
          clientId: client.id,
          timezone: promptContext.timezone,
        })) ?? NO_APPOINTMENT_REPLY;

      await this.record({
        input,
        conversation,
        client,
        reply: summary,
        rawJson: { intent: AssistantIntent.SUMMARY },
      });
      return { ...base, reply: summary, wantsBooking: false };
    }

    if (
      routerResult.intent === AssistantIntent.GREETING &&
      conversation.contextJson?.hasAssistantIntroduced !== true
    ) {
      await this.assistantContextService.markAssistantIntroduced(conversation);
    }

    const historyMessages =
      await this.assistantMessagingService.getConversationHistory({
        conversationId: conversation.id,
        limit: 6,
      });

    const systemAddon = resolvePromptForIntent({
      intent: routerResult.intent,
      promptContext,
      conversation,
    });

    const { response, parsed } =
      await this.assistantAIService.executeChatWithSystemAddon({
        promptContext,
        historyMessages,
        systemAddon,
      });

    const reply = await this.assistantReplyEnricherService.enrich({
      tenantId: input.tenantId,
      promptContext,
      historyMessages,
      baseReply: parsed.reply,
    });

    await this.record({
      input,
      conversation,
      client,
      reply,
      rawJson: response,
    });

    return { ...base, reply, wantsBooking: false };
  }

  private async record(params: {
    input: AssistantChatDto;
    conversation: { id: string };
    client: { id: string };
    reply: string;
    rawJson: unknown;
  }): Promise<void> {
    const { input, conversation, client, reply, rawJson } = params;

    await this.assistantMessagingService.saveAssistantMessage({
      tenantId: input.tenantId,
      conversationId: conversation.id,
      clientId: client.id,
      content: reply,
      rawJson,
    });
    await this.assistantMessagingService.touchConversationLastMessageAt(
      conversation.id,
    );
  }

  simpleChat(input: AssistantSimpleDto) {
    void input;
    throw new Error(
      'simpleChat no está soportado: se requiere tenantId para construir el prompt.',
    );
  }
}
