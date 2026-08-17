import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  buildButtonsPayload,
  buildFlowPayload,
  buildListPayload,
  buildTextPayload,
  type BuiltMessage,
} from './outgoing-message.builder';
import {
  type SendButtonsInput,
  type SendFlowInput,
  type SendListInput,
  type SendTextInput,
  type WhatsAppCredentials,
} from './types/outgoing-message.type';

export type SendResult = {
  ok: boolean;
  /** `id` del mensaje asignado por Meta, cuando el envío fue exitoso. */
  metaMessageId?: string;
  error?: string;
};

/**
 * Única salida hacia la Cloud API de WhatsApp.
 *
 * Sabe enviar texto, botones y listas. Los renderizadores del flujo de reserva
 * hablan con este servicio y no construyen payloads por su cuenta.
 */
@Injectable()
export class WhatsAppSenderService {
  private readonly logger = new Logger(WhatsAppSenderService.name);

  constructor(private readonly configService: ConfigService) {}

  sendText(
    credentials: WhatsAppCredentials,
    input: SendTextInput,
  ): Promise<SendResult> {
    return this.send(credentials, input.to, 'text', buildTextPayload(input));
  }

  sendButtons(
    credentials: WhatsAppCredentials,
    input: SendButtonsInput,
  ): Promise<SendResult> {
    return this.send(
      credentials,
      input.to,
      'buttons',
      buildButtonsPayload(input),
    );
  }

  sendList(
    credentials: WhatsAppCredentials,
    input: SendListInput,
  ): Promise<SendResult> {
    return this.send(credentials, input.to, 'list', buildListPayload(input));
  }

  /** Abre un WhatsApp Flow. El resto de la conversación ocurre en su endpoint. */
  sendFlow(
    credentials: WhatsAppCredentials,
    input: SendFlowInput,
  ): Promise<SendResult> {
    return this.send(credentials, input.to, 'flow', buildFlowPayload(input));
  }

  private async send(
    credentials: WhatsAppCredentials,
    to: string,
    kind: string,
    built: BuiltMessage,
  ): Promise<SendResult> {
    for (const warning of built.warnings) {
      this.logger.warn(`WhatsApp ${kind} (to=${to}): ${warning}`);
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      ...built.payload,
    };

    const url = `https://graph.facebook.com/${this.graphVersion}/${encodeURIComponent(
      credentials.phoneNumberId,
    )}/messages`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const rawText = await response.text();

      if (!response.ok) {
        this.logger.error(
          `WhatsApp send failed (kind=${kind}, status=${response.status}, to=${to}, phoneNumberId=${credentials.phoneNumberId}): ${rawText}`,
        );
        return { ok: false, error: rawText };
      }

      const metaMessageId = readMetaMessageId(rawText);
      this.logger.log(
        `WhatsApp send OK (kind=${kind}, to=${to}, phoneNumberId=${credentials.phoneNumberId}, metaMessageId=${String(
          metaMessageId,
        )})`,
      );
      return { ok: true, metaMessageId };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
      this.logger.error(
        `WhatsApp send error (kind=${kind}, to=${to}, phoneNumberId=${credentials.phoneNumberId}): ${errorMessage}`,
      );
      return { ok: false, error: errorMessage };
    }
  }

  private get graphVersion(): string {
    return this.configService.get<string>('WHATSAPP_GRAPH_VERSION') ?? 'v21.0';
  }
}

function readMetaMessageId(rawText: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(rawText);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const messages = (parsed as { messages?: unknown }).messages;
    if (!Array.isArray(messages) || messages.length === 0) return undefined;
    const first: unknown = messages[0];
    if (typeof first !== 'object' || first === null) return undefined;
    const id = (first as { id?: unknown }).id;
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}
