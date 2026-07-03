import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssistantService } from '../assistant/assistant.service';
import { TenantsService } from '../tenants/tenants.service';
import {
  asObject,
  getArrayField,
  getObjectField,
  getStringField,
  normalizePhoneNumber,
} from './webhook-meta.util';

export type SendTextMessageArgs = {
  to: string;
  message: string;
  accessToken?: string;
  phoneNumberId?: string;
};

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly tenantsService: TenantsService,
    private readonly assistantService: AssistantService,
  ) {}

  async handleIncomingWhatsAppWebhook(body: unknown): Promise<void> {
    let metaMessageId: string | null = null;

    try {
      const data = asObject(body);
      if (!data) return;

      const entry0Obj = asObject(getArrayField(data, 'entry')?.[0]);
      if (!entry0Obj) return;

      const changes0Obj = asObject(getArrayField(entry0Obj, 'changes')?.[0]);
      if (!changes0Obj) return;

      const value = getObjectField(changes0Obj, 'value');
      if (!value) return;

      const messageObj = asObject(getArrayField(value, 'messages')?.[0]);
      metaMessageId = messageObj ? getStringField(messageObj, 'id') : null;
      const from = messageObj ? getStringField(messageObj, 'from') : null;
      const textObj = messageObj ? getObjectField(messageObj, 'text') : null;
      const incomingText = textObj ? getStringField(textObj, 'body') : null;

      const contact0Obj = asObject(getArrayField(value, 'contacts')?.[0]);
      const contactProfile = contact0Obj
        ? getObjectField(contact0Obj, 'profile')
        : null;
      const contactName = contactProfile
        ? getStringField(contactProfile, 'name')
        : null;

      const metadata = getObjectField(value, 'metadata');
      const phoneNumberId = metadata
        ? getStringField(metadata, 'phone_number_id')
        : null;
      const displayPhoneNumber = metadata
        ? getStringField(metadata, 'display_phone_number')
        : null;

      if (!from || !phoneNumberId) return;

      const normalizedDisplayPhone = displayPhoneNumber
        ? normalizePhoneNumber(displayPhoneNumber)
        : null;

      const tenant = normalizedDisplayPhone
        ? await this.tenantsService.findByWhatsappPhoneNumber(
            normalizedDisplayPhone,
          )
        : null;

      if (!tenant) {
        this.logger.warn(
          `Webhook dropped (metaMessageId=${String(
            metaMessageId,
          )}): no tenant match (displayPhoneNumber=${String(
            displayPhoneNumber,
          )}, from=${from}).`,
        );
        return;
      }

      if (incomingText) {
        this.logger.log(
          `Incoming WhatsApp text (metaMessageId=${String(
            metaMessageId,
          )}, tenantId=${tenant.id}, from=${from}): ${incomingText}`,
        );
      }

      const reply = incomingText
        ? (
            await this.assistantService.chat({
              tenantId: tenant.id,
              phone: from,
              clientName: contactName ?? undefined,
              messageText: incomingText,
            })
          ).reply
        : 'Hola 👋';

      this.logger.log(
        `AI reply (metaMessageId=${String(
          metaMessageId,
        )}, tenantId=${tenant.id}, to=${from}): ${reply}`,
      );

      await this.sendTextMessageWithCredentials({
        to: from,
        message: reply,
        accessToken:
          tenant.whatsappSystemUserAccessToken ?? tenant.whatsappAccessToken,
        phoneNumberId: tenant.whatsappPhoneId ?? phoneNumberId,
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.logger.error(
        `Webhook processing error (metaMessageId=${String(
          metaMessageId,
        )}): ${errorMessage}`,
      );
    }
  }

  async sendTextMessageWithCredentials({
    to,
    message,
    accessToken,
    phoneNumberId,
  }: SendTextMessageArgs): Promise<void> {
    if (!accessToken || !phoneNumberId) {
      this.logger.warn(
        `Missing WhatsApp credentials (to=${to}, phoneNumberId=${String(
          phoneNumberId,
        )})`,
      );
      return;
    }

    const trimmedMessage = message.trim();
    if (trimmedMessage.length === 0) return;

    const graphVersion =
      this.configService.get<string>('WHATSAPP_GRAPH_VERSION') ?? 'v21.0';
    const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(
      phoneNumberId,
    )}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        preview_url: false,
        body: trimmedMessage,
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const rawText = await response.text();
      if (!response.ok) {
        this.logger.error(
          `WhatsApp send failed (status=${response.status}, to=${to}, phoneNumberId=${phoneNumberId}): ${rawText}`,
        );
        return;
      }

      this.logger.log(
        `WhatsApp send OK (to=${to}, phoneNumberId=${phoneNumberId}): ${rawText}`,
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
      this.logger.error(
        `WhatsApp send error (to=${to}, phoneNumberId=${phoneNumberId}): ${errorMessage}`,
      );
    }
  }
}
