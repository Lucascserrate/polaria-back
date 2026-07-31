import { Injectable, Logger } from '@nestjs/common';

import { TenantsService } from '../tenants/tenants.service';
import { parseIncomingWhatsAppMessage } from '../whatsapp/incoming-message.parser';
import type { IncomingWhatsAppMessage } from '../whatsapp/types/incoming-message.type';
import type { WhatsAppCredentials } from '../whatsapp/types/outgoing-message.type';
import { InboundMessageService } from './inbound-message.service';
import {
  asObject,
  getArrayField,
  getStringField,
  normalizePhoneNumber,
} from './webhook-meta.util';
import type { Tenant } from '../tenants/entities/tenant.entity';

/**
 * Campos que Meta solo entrega cuando el número está en Coexistence (app de
 * WhatsApp Business + Cloud API sobre el mismo número).
 *
 * Hoy no se ingieren: `parseIncomingWhatsAppMessage` los descarta porque no
 * traen `value.messages`. Se listan para poder distinguir en los logs un evento
 * de Coexistence de un webhook malformado.
 */
const COEXISTENCE_WEBHOOK_FIELDS = new Set([
  'history',
  'smb_app_state_sync',
  'smb_message_echoes',
]);

/**
 * Borde de entrada de WhatsApp.
 *
 * Solo hace tres cosas: parsear el webhook, resolver el tenant y sus credenciales,
 * y delegar. Ninguna decisión de producto vive acá.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly tenantsService: TenantsService,
    private readonly inboundMessageService: InboundMessageService,
  ) {}

  async handleIncomingWhatsAppWebhook(body: unknown): Promise<void> {
    let metaMessageId: string | null = null;

    try {
      const coexistenceField = this.readCoexistenceField(body);
      if (coexistenceField) {
        this.logger.log(
          `Webhook de Coexistence ignorado (field=${coexistenceField}).`,
        );
        return;
      }

      const message = parseIncomingWhatsAppMessage(body);
      if (!message) return;

      metaMessageId = message.metaMessageId;

      const tenant = await this.resolveTenant(message);
      if (!tenant) return;

      const credentials = this.resolveCredentials(tenant, message);
      if (!credentials) return;

      this.logger.log(
        `Mensaje entrante (metaMessageId=${String(metaMessageId)}, tenantId=${
          tenant.id
        }, from=${message.from}, kind=${message.kind}).`,
      );

      await this.inboundMessageService.handle({
        tenantId: tenant.id,
        credentials,
        message,
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

  private readCoexistenceField(body: unknown): string | null {
    const data = asObject(body);
    if (!data) return null;

    const entry = asObject(getArrayField(data, 'entry')?.[0]);
    if (!entry) return null;

    const change = asObject(getArrayField(entry, 'changes')?.[0]);
    if (!change) return null;

    const field = getStringField(change, 'field');
    return field && COEXISTENCE_WEBHOOK_FIELDS.has(field) ? field : null;
  }

  private async resolveTenant(
    message: IncomingWhatsAppMessage,
  ): Promise<Tenant | null> {
    const tenantByPhoneId = await this.tenantsService.findByWhatsappPhoneId(
      message.phoneNumberId,
    );
    if (tenantByPhoneId) {
      return tenantByPhoneId;
    }

    const normalizedDisplayPhone = message.displayPhoneNumber
      ? normalizePhoneNumber(message.displayPhoneNumber)
      : null;

    const displayPhoneCandidates = normalizedDisplayPhone
      ? [normalizedDisplayPhone, `+${normalizedDisplayPhone}`]
      : [];

    const tenant = await this.findTenantByWhatsappPhoneNumberCandidates(
      displayPhoneCandidates,
    );

    if (!tenant) {
      this.logger.warn(
        `Webhook dropped (metaMessageId=${String(
          message.metaMessageId,
        )}): no tenant match (displayPhoneNumber=${String(
          message.displayPhoneNumber,
        )}, from=${message.from}).`,
      );
      return null;
    }

    return tenant;
  }

  private async findTenantByWhatsappPhoneNumberCandidates(
    candidates: string[],
  ): Promise<Tenant | null> {
    for (const candidate of candidates) {
      const tenant =
        await this.tenantsService.findByWhatsappPhoneNumber(candidate);
      if (tenant) return tenant;
    }

    return null;
  }

  private resolveCredentials(
    tenant: Tenant,
    message: IncomingWhatsAppMessage,
  ): WhatsAppCredentials | null {
    const accessToken =
      tenant.whatsappSystemUserAccessToken ?? tenant.whatsappAccessToken;
    const phoneNumberId = tenant.whatsappPhoneId ?? message.phoneNumberId;

    if (!accessToken || !phoneNumberId) {
      this.logger.warn(
        `Missing WhatsApp credentials (tenantId=${tenant.id}, to=${
          message.from
        }, phoneNumberId=${String(phoneNumberId)})`,
      );
      return null;
    }

    return { accessToken, phoneNumberId };
  }
}
