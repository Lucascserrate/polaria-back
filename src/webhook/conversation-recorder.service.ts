import { Injectable, Logger } from '@nestjs/common';

import { ConversationsService } from '../conversations/conversations.service';
import { MessageRole } from '../messages/entities/message.entity';
import { MessagesService } from '../messages/messages.service';
import type { RenderedBookingMessage } from '../whatsapp/booking-prompt.renderer';
import type { IncomingWhatsAppMessage } from '../whatsapp/types/incoming-message.type';
import { IncomingMessageKind } from '../whatsapp/types/incoming-message.type';

/**
 * Registro de la conversación en `messages`.
 *
 * El asistente ya guardaba lo suyo, pero el flujo guiado no: sus listas y botones
 * salían sin dejar rastro, y el panel de la barbería veía el hilo con huecos —el
 * cliente pedía turno y lo siguiente visible era nada, aunque la cita se hubiera
 * creado. Esto cierra ese hueco en los dos sentidos.
 *
 * Un fallo al registrar nunca interrumpe la conversación: es peor no responderle
 * al cliente que perder una línea del historial.
 */
@Injectable()
export class ConversationRecorderService {
  private readonly logger = new Logger(ConversationRecorderService.name);

  constructor(
    private readonly messagesService: MessagesService,
    private readonly conversationsService: ConversationsService,
  ) {}

  /**
   * Registra lo que el cliente eligió en una lista o botón.
   *
   * Se guarda el título visible, que es lo que el cliente vio y tocó. El
   * `selectionId` va a `rawJson`: sirve para diagnosticar, pero como línea de
   * conversación no significa nada.
   */
  async recordSelection(params: {
    tenantId: string;
    conversationId: string;
    clientId: string;
    message: IncomingWhatsAppMessage;
  }): Promise<void> {
    const { tenantId, conversationId, clientId, message } = params;

    if (
      message.kind !== IncomingMessageKind.BUTTON_REPLY &&
      message.kind !== IncomingMessageKind.LIST_REPLY
    ) {
      return;
    }

    await this.save({
      tenantId,
      conversationId,
      clientId,
      role: MessageRole.USER,
      content: message.title ?? message.selectionId,
      rawJson: {
        source: 'booking-flow',
        kind: message.kind,
        selectionId: message.selectionId,
        metaMessageId: message.metaMessageId,
      },
    });
  }

  /**
   * Registra un texto libre que no pasó por el asistente.
   *
   * Solo hace falta en el camino congelado: en el resto, el asistente ya guarda
   * el mensaje del cliente antes de responder.
   */
  async recordIncomingText(params: {
    tenantId: string;
    conversationId: string;
    clientId: string;
    text: string;
  }): Promise<void> {
    await this.save({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      clientId: params.clientId,
      role: MessageRole.USER,
      content: params.text,
      rawJson: { source: 'booking-flow', frozen: true },
    });
  }

  /**
   * Registra un mensaje saliente que no vino del flujo de reservas: el menú de
   * bienvenida o el aviso de traspaso a una persona.
   */
  async recordOutgoingText(params: {
    tenantId: string;
    conversationId: string;
    clientId: string;
    text: string;
    source: string;
  }): Promise<void> {
    await this.save({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      clientId: params.clientId,
      role: MessageRole.ASSISTANT,
      content: params.text,
      rawJson: { source: params.source },
    });

    await this.touch(params.conversationId);
  }

  /** Registra los mensajes del flujo que WhatsApp entregó. */
  async recordRendered(params: {
    tenantId: string;
    conversationId: string;
    clientId: string;
    rendered: RenderedBookingMessage[];
  }): Promise<void> {
    const { tenantId, conversationId, clientId, rendered } = params;

    for (const message of rendered) {
      await this.save({
        tenantId,
        conversationId,
        clientId,
        role: MessageRole.ASSISTANT,
        content: message.content,
        rawJson: message.raw,
      });
    }

    if (rendered.length > 0) {
      await this.touch(conversationId);
    }
  }

  private async save(params: {
    tenantId: string;
    conversationId: string;
    clientId: string;
    role: MessageRole;
    content: string;
    rawJson: unknown;
  }): Promise<void> {
    try {
      await this.messagesService.create(params);
    } catch (error: unknown) {
      const detail =
        error instanceof Error ? error.message : JSON.stringify(error);
      this.logger.error(
        `No se pudo registrar el mensaje (conversationId=${params.conversationId}): ${detail}`,
      );
    }
  }

  private async touch(conversationId: string): Promise<void> {
    try {
      await this.conversationsService.update(conversationId, {
        lastMessageAt: new Date(),
      });
    } catch (error: unknown) {
      const detail =
        error instanceof Error ? error.message : JSON.stringify(error);
      this.logger.error(
        `No se pudo actualizar lastMessageAt (conversationId=${conversationId}): ${detail}`,
      );
    }
  }
}
