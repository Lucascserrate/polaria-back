import { Injectable, Logger } from '@nestjs/common';

import { AssistantSessionService } from '../assistant/services/assistant-session.service';
import { BookingFlowService } from '../booking-flow/booking-flow.service';
import type { BookingPrompt } from '../booking-flow/booking-flow.types';
import { detectBookingTrigger } from '../booking-flow/booking-trigger';
import { ConversationControlService } from '../conversations/conversation-control.service';
import type { Conversation } from '../conversations/entities/conversation.entity';
import {
  buildHandoffAcknowledgement,
  buildWelcomeMenu,
  decodeMenuAction,
  shouldSendWelcomeMenu,
  WELCOME_MENU_SOURCE,
  WelcomeMenuAction,
} from '../conversations/welcome-menu';
import { TenantsService } from '../tenants/tenants.service';
import {
  BookingPromptRenderer,
  NATIVE_CHANNEL_LIMITS,
} from '../whatsapp/booking-prompt.renderer';
import {
  IncomingMessageKind,
  type IncomingWhatsAppMessage,
} from '../whatsapp/types/incoming-message.type';
import type { WhatsAppCredentials } from '../whatsapp/types/outgoing-message.type';
import { WhatsAppSenderService } from '../whatsapp/whatsapp-sender.service';
import { ConversationRecorderService } from './conversation-recorder.service';

const UNSUPPORTED_MESSAGE_REPLY =
  'Por ahora solo puedo leer mensajes de texto. Escríbeme y te ayudo.';

/**
 * Reparto de los mensajes entrantes entre el flujo guiado y el asistente.
 *
 * Es donde vive la regla central del producto: **si hay una reserva en curso, el
 * texto libre no llega a la IA**. Y una respuesta interactiva nunca llega a la IA,
 * haya sesión o no.
 *
 * La IA conserva un único poder sobre las reservas: detectar la intención y
 * arrancar el flujo. No aporta ningún dato.
 */
@Injectable()
export class InboundMessageService {
  private readonly logger = new Logger(InboundMessageService.name);

  constructor(
    private readonly assistantSessionService: AssistantSessionService,
    private readonly bookingFlowService: BookingFlowService,
    private readonly bookingPromptRenderer: BookingPromptRenderer,
    private readonly whatsAppSenderService: WhatsAppSenderService,
    private readonly conversationRecorder: ConversationRecorderService,
    private readonly conversationControl: ConversationControlService,
    private readonly tenantsService: TenantsService,
  ) {}

  async handle(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    message: IncomingWhatsAppMessage;
  }): Promise<void> {
    const { tenantId, credentials, message } = params;

    switch (message.kind) {
      case IncomingMessageKind.BUTTON_REPLY:
      case IncomingMessageKind.LIST_REPLY:
        await this.handleSelection({
          tenantId,
          credentials,
          message,
          selectionId: message.selectionId,
        });
        return;

      case IncomingMessageKind.TEXT:
        await this.handleText({
          tenantId,
          credentials,
          message,
          text: message.text,
        });
        return;

      case IncomingMessageKind.FLOW_REPLY:
        // Los Flows se cablearán con su propio renderizador; hoy no se envían.
        this.logger.log(
          `FLOW_REPLY recibido sin manejador (tenantId=${tenantId}, flowToken=${String(message.flowToken)}).`,
        );
        return;

      case IncomingMessageKind.UNSUPPORTED:
        await this.handleUnsupported({ tenantId, credentials, message });
        return;
    }
  }

  /**
   * Respuesta a una lista o botón. Nunca llega a la IA.
   *
   * Hay dos familias de respuestas interactivas y se distinguen por el prefijo del
   * id: las del menú (`menu|…`) y las del flujo de reserva (`b1|…`). El flujo
   * decide por sí solo si su interacción es válida, obsoleta o ajena, así que para
   * esa rama no hay comprobación previa acá.
   */
  private async handleSelection(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    message: IncomingWhatsAppMessage;
    selectionId: string;
  }): Promise<void> {
    const { tenantId, credentials, message, selectionId } = params;

    const { client, conversation } =
      await this.assistantSessionService.getOrCreateSession({
        tenantId,
        phone: message.from,
        clientName: message.contactName ?? undefined,
      });

    if (this.conversationControl.isHandedOff(conversation)) {
      await this.recordAndStayQuiet({
        tenantId,
        conversation,
        client,
        message,
      });
      return;
    }

    const menuAction = decodeMenuAction(selectionId);
    if (menuAction) {
      await this.handleMenuAction({
        tenantId,
        credentials,
        message,
        conversation,
        clientId: client.id,
        action: menuAction,
      });
      return;
    }

    const prompt = await this.bookingFlowService.handleSelection({
      tenantId,
      clientId: client.id,
      rawSelectionId: selectionId,
      metaMessageId: message.metaMessageId,
      limits: NATIVE_CHANNEL_LIMITS,
    });

    // `NONE` significa que el flujo reconoció una reentrega del mismo webhook.
    // Registrar la selección otra vez duplicaría una línea del historial que ya
    // existe, así que se descarta entera.
    if (prompt.kind === 'NONE') return;

    await this.conversationRecorder.recordSelection({
      tenantId,
      conversationId: conversation.id,
      clientId: client.id,
      message,
    });

    await this.renderAndRecord({
      tenantId,
      credentials,
      conversationId: conversation.id,
      clientId: client.id,
      to: message.from,
      prompt,
    });
  }

  private async handleText(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    message: IncomingWhatsAppMessage;
    text: string;
  }): Promise<void> {
    const { tenantId, credentials, message, text } = params;

    const { client, conversation } =
      await this.assistantSessionService.getOrCreateSession({
        tenantId,
        phone: message.from,
        clientName: message.contactName ?? undefined,
      });

    // 0. La conversación está en manos del negocio. Polaria no dice nada, pero
    //    registra el mensaje para que el hilo quede completo.
    if (this.conversationControl.isHandedOff(conversation)) {
      await this.recordAndStayQuiet({
        tenantId,
        conversation,
        client,
        message,
      });
      return;
    }

    // 1. Conversación congelada: hay una reserva en curso. El texto no se
    //    interpreta; se recuerda el paso pendiente y se reenvía el componente.
    const frozen = await this.bookingFlowService.handleFreeText({
      tenantId,
      clientId: client.id,
      limits: NATIVE_CHANNEL_LIMITS,
    });

    if (frozen) {
      this.logger.log(
        `Texto libre durante reserva, no interpretado (tenantId=${tenantId}, clientId=${client.id}).`,
      );

      // El asistente no interviene, así que el mensaje del cliente lo registra
      // este camino; si no, el hilo mostraría la respuesta sin la pregunta.
      await this.conversationRecorder.recordIncomingText({
        tenantId,
        conversationId: conversation.id,
        clientId: client.id,
        text,
      });

      await this.renderAndRecord({
        tenantId,
        credentials,
        conversationId: conversation.id,
        clientId: client.id,
        to: message.from,
        prompt: frozen,
      });
      return;
    }

    await this.conversationRecorder.recordIncomingText({
      tenantId,
      conversationId: conversation.id,
      clientId: client.id,
      text,
    });

    // 2. Pedido explícito de turno: se entra al flujo sin pasar por el menú.
    //    Mostrarle un menú a quien ya dijo lo que quiere es un paso de más.
    if (detectBookingTrigger(text)) {
      this.logger.log(
        `Intención de reserva detectada (tenantId=${tenantId}, clientId=${client.id}).`,
      );

      const prompt = await this.bookingFlowService.start({
        tenantId,
        clientId: client.id,
        conversationId: conversation.id,
      });

      await this.renderAndRecord({
        tenantId,
        credentials,
        conversationId: conversation.id,
        clientId: client.id,
        to: message.from,
        prompt,
      });
      return;
    }

    // 3. Cualquier otro texto: menú de bienvenida. Polaria no simula responder
    //    preguntas abiertas; ofrece lo que sabe hacer y la salida a una persona.
    await this.sendWelcomeMenu({
      tenantId,
      credentials,
      conversationId: conversation.id,
      clientId: client.id,
      to: message.from,
    });
  }

  /**
   * Acción del menú de bienvenida.
   *
   * Son las dos únicas cosas que Polaria ofrece hacer: agendar, o apartarse.
   */
  private async handleMenuAction(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    message: IncomingWhatsAppMessage;
    conversation: Conversation;
    clientId: string;
    action: WelcomeMenuAction;
  }): Promise<void> {
    const { tenantId, credentials, message, conversation, clientId, action } =
      params;

    await this.conversationRecorder.recordSelection({
      tenantId,
      conversationId: conversation.id,
      clientId,
      message,
    });

    if (action === WelcomeMenuAction.BOOK) {
      const prompt = await this.bookingFlowService.start({
        tenantId,
        clientId,
        conversationId: conversation.id,
      });

      await this.renderAndRecord({
        tenantId,
        credentials,
        conversationId: conversation.id,
        clientId,
        to: message.from,
        prompt,
      });
      return;
    }

    await this.conversationControl.handOff({ conversation });

    const acknowledgement = buildHandoffAcknowledgement();
    const sent = await this.whatsAppSenderService.sendText(credentials, {
      to: message.from,
      body: acknowledgement,
    });

    if (sent.ok) {
      await this.conversationRecorder.recordOutgoingText({
        tenantId,
        conversationId: conversation.id,
        clientId,
        text: acknowledgement,
        source: 'handoff',
      });
    }
  }

  /** Menú de bienvenida: el alcance de Polaria, dicho de forma honesta. */
  private async sendWelcomeMenu(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    conversationId: string;
    clientId: string;
    to: string;
  }): Promise<void> {
    // Enfriamiento: varios mensajes seguidos sin intención detectada no deben
    // producir varios menús idénticos.
    const lastOutgoing = await this.conversationRecorder.findLastOutgoing(
      params.conversationId,
    );

    const allowed = shouldSendWelcomeMenu({
      lastOutgoingSource: lastOutgoing?.source,
      lastOutgoingAt: lastOutgoing?.createdAt,
      now: new Date(),
    });

    if (!allowed) {
      this.logger.log(
        `Menú omitido por enfriamiento (conversationId=${params.conversationId}).`,
      );
      return;
    }

    const tenant = await this.tenantsService.findOne(params.tenantId);
    const menu = buildWelcomeMenu(tenant?.name ?? 'la barbería');

    const sent = await this.whatsAppSenderService.sendButtons(
      params.credentials,
      {
        to: params.to,
        body: menu.body,
        buttons: menu.options.map((option) => ({
          id: option.id,
          title: option.title,
        })),
      },
    );

    if (!sent.ok) return;

    await this.conversationRecorder.recordOutgoingText({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      clientId: params.clientId,
      text: `${menu.body}\n\nOpciones: ${menu.options
        .map((option) => option.title)
        .join(' · ')}`,
      source: WELCOME_MENU_SOURCE,
    });
  }

  /**
   * Registra un mensaje entrante sin responder.
   *
   * Es lo que hace Polaria mientras la conversación está en manos del negocio: el
   * hilo queda completo en el panel, pero el cliente no recibe nada automático.
   */
  private async recordAndStayQuiet(params: {
    tenantId: string;
    conversation: Conversation;
    client: { id: string };
    message: IncomingWhatsAppMessage;
  }): Promise<void> {
    const { tenantId, conversation, client, message } = params;

    this.logger.log(
      `Conversación en handoff, Polaria no responde (conversationId=${conversation.id}).`,
    );

    if (message.kind === IncomingMessageKind.TEXT) {
      await this.conversationRecorder.recordIncomingText({
        tenantId,
        conversationId: conversation.id,
        clientId: client.id,
        text: message.text,
      });
      return;
    }

    await this.conversationRecorder.recordSelection({
      tenantId,
      conversationId: conversation.id,
      clientId: client.id,
      message,
    });
  }

  /**
   * Audio, imagen, ubicación y demás.
   *
   * Con una reserva en curso se reenvía el paso pendiente, por el mismo motivo que
   * con el texto: el cliente tiene que poder seguir sin quedar trabado.
   */
  private async handleUnsupported(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    message: IncomingWhatsAppMessage;
  }): Promise<void> {
    const { tenantId, credentials, message } = params;

    const { client, conversation } =
      await this.assistantSessionService.getOrCreateSession({
        tenantId,
        phone: message.from,
        clientName: message.contactName ?? undefined,
      });

    if (this.conversationControl.isHandedOff(conversation)) {
      await this.recordAndStayQuiet({
        tenantId,
        conversation,
        client,
        message,
      });
      return;
    }

    const frozen = await this.bookingFlowService.handleFreeText({
      tenantId,
      clientId: client.id,
      limits: NATIVE_CHANNEL_LIMITS,
    });

    if (frozen) {
      await this.renderAndRecord({
        tenantId,
        credentials,
        conversationId: conversation.id,
        clientId: client.id,
        to: message.from,
        prompt: frozen,
      });
      return;
    }

    await this.whatsAppSenderService.sendText(credentials, {
      to: message.from,
      body: UNSUPPORTED_MESSAGE_REPLY,
    });
  }

  /** Envía el paso del flujo y deja constancia de lo que WhatsApp entregó. */
  private async renderAndRecord(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    conversationId: string;
    clientId: string;
    to: string;
    prompt: BookingPrompt;
  }): Promise<void> {
    const rendered = await this.bookingPromptRenderer.render({
      credentials: params.credentials,
      to: params.to,
      prompt: params.prompt,
    });

    await this.conversationRecorder.recordRendered({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      clientId: params.clientId,
      rendered,
    });
  }
}
