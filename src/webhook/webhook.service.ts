import { Injectable, Logger } from '@nestjs/common';
import { TenantsService } from '../tenants/tenants.service';
import { WhatsappMessageSenderService } from '../whatsapp/whatsapp-message-sender.service';
import {
  asObject,
  getArrayField,
  getObjectField,
  getStringField,
  normalizePhoneNumber,
} from './webhook-meta.util';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly tenantsService: TenantsService,
    private readonly whatsappMessageSenderService: WhatsappMessageSenderService,
  ) {}

  async handleIncomingWhatsAppWebhook(body: unknown): Promise<void> {
    this.logger.log(
      `[Webhook] handleIncomingWhatsAppWebhook entered type=${typeof body} isArray=${Array.isArray(body)}`,
    );
    this.logger.log(`[Webhook] Body received: ${this.safeJson(body)}`);

    const parsed = this.parseIncoming(body);
    if (!parsed) {
      this.logger.warn(
        `[Webhook] Payload ignored: could not parse incoming event keys=${this.describePayload(body)} reason=unsupported-or-missing-structure`,
      );
      return;
    }

    const { from, contactName, phoneNumberId, displayPhoneNumber, text } =
      parsed;
    this.logger.log(
      `[Webhook] parseIncoming succeeded from=${from} phoneNumberId=${phoneNumberId} displayPhoneNumber=${displayPhoneNumber} contactName=${contactName ?? 'null'} text=${text ?? 'null'}`,
    );
    if (!text) {
      this.logger.log(
        `[Webhook] Incoming webhook ignored: non-text message from=${from} phoneNumberId=${phoneNumberId}`,
      );
      return;
    }

    this.logger.log(
      `[Webhook] Searching tenant by phoneNumberId=${phoneNumberId} displayPhoneNumber=${displayPhoneNumber}`,
    );
    const tenant =
      (await this.tenantsService.findByWhatsappPhoneId(phoneNumberId)) ??
      (await this.tenantsService.findByWhatsappPhoneNumber(
        normalizePhoneNumber(displayPhoneNumber),
      )) ??
      (await this.tenantsService.findByWhatsappPhoneNumber(displayPhoneNumber));

    if (!tenant) {
      this.logger.warn(
        `[Webhook] No tenant matched phoneNumberId=${phoneNumberId} displayPhoneNumber=${displayPhoneNumber} from=${from}`,
      );
      return;
    }

    this.logger.log(
      `[Webhook] Tenant identified tenantId=${tenant.id} tenantName=${tenant.name}`,
    );
    this.logger.log(
      `[Webhook] Incoming message details from=${from} text=${text}`,
    );

    const replyText = `Hola, soy Polaria, el asistente virtual de ${tenant.name}.\n\n¿Cómo puedo ayudarte?`;
    const replyPhoneNumberId = tenant.whatsappPhoneId ?? phoneNumberId;
    const accessToken = tenant.whatsappAccessToken;

    this.logger.log(
      `[WhatsApp] Preparing fixed reply tenantId=${tenant.id} to=${from} replyPhoneNumberId=${replyPhoneNumberId} accessTokenPresent=${Boolean(accessToken)}`,
    );

    try {
      const sent = await this.whatsappMessageSenderService.sendText({
        to: from,
        text: replyText,
        accessToken,
        phoneNumberId: replyPhoneNumberId,
      });

      if (!sent) {
        this.logger.warn(
          `[WhatsApp] Reply skipped tenantId=${tenant.id} missing accessToken or phoneNumberId`,
        );
        return;
      }

      this.logger.log(
        `[WhatsApp] Reply sent tenantId=${tenant.id} to=${from} usingPhoneNumberId=${replyPhoneNumberId}`,
      );
    } catch (error) {
      this.logger.error(
        `[WhatsApp] Reply failed tenantId=${tenant.id} to=${from} error=${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.logger.log(
      '[Webhook] handleIncomingWhatsAppWebhook completed successfully',
    );
  }

  private parseIncoming(body: unknown): null | {
    from: string;
    contactName: string | null;
    phoneNumberId: string;
    displayPhoneNumber: string;
    text: string | null;
  } {
    const data = asObject(body);
    if (!data) return null;

    const entry0 = getArrayField(data, 'entry')?.[0];
    const entry0Obj = entry0 ? asObject(entry0) : null;
    const changes0 = entry0Obj
      ? getArrayField(entry0Obj, 'changes')?.[0]
      : null;
    const changes0Obj = changes0 ? asObject(changes0) : null;
    const value = changes0Obj ? getObjectField(changes0Obj, 'value') : null;
    if (!value) return null;

    const messageObj = asObject(getArrayField(value, 'messages')?.[0]);
    if (!messageObj) return null;

    const from = getStringField(messageObj, 'from');
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

    if (!from || !phoneNumberId || !displayPhoneNumber) return null;

    const textObj = getObjectField(messageObj, 'text');
    const text = textObj ? getStringField(textObj, 'body') : null;

    return {
      from,
      contactName,
      phoneNumberId,
      displayPhoneNumber,
      text,
    };
  }

  private describePayload(body: unknown): string {
    const data = asObject(body);
    if (!data) return 'non-object';
    return Object.keys(data).slice(0, 10).join(',');
  }

  private safeJson(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable-body]';
    }
  }
}
