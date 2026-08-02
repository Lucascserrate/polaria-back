import { Injectable, Logger } from '@nestjs/common';

import { AssistantService } from '../assistant/assistant.service';
import { AssistantSessionService } from '../assistant/services/assistant-session.service';
import { BookingFlowService } from '../booking-flow/booking-flow.service';
import type { BookingPrompt } from '../booking-flow/booking-flow.types';
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
    private readonly assistantService: AssistantService,
    private readonly bookingFlowService: BookingFlowService,
    private readonly bookingPromptRenderer: BookingPromptRenderer,
    private readonly whatsAppSenderService: WhatsAppSenderService,
    private readonly conversationRecorder: ConversationRecorderService,
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
   * Respuesta a una lista o botón: siempre va al flujo, nunca a la IA.
   *
   * El flujo decide por sí solo si la interacción es válida, obsoleta o ajena, así
   * que acá no hay ninguna comprobación previa.
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

    // 2. Conversación libre. El asistente responde la pregunta o, si detecta
    //    intención de reservar, cede el control sin redactar nada. Es lo único
    //    que puede provocar sobre una reserva. El asistente ya registra por su
    //    cuenta el mensaje del cliente y su propia respuesta.
    const { reply, wantsBooking } = await this.assistantService.chat({
      tenantId,
      phone: message.from,
      clientName: message.contactName ?? undefined,
      messageText: text,
    });

    if (wantsBooking) {
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

    await this.whatsAppSenderService.sendText(credentials, {
      to: message.from,
      body: reply,
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
