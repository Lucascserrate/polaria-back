import { Injectable, Logger } from '@nestjs/common';

import { TenantsService } from '../tenants/tenants.service';
import { parseIncomingWhatsAppMessage } from '../whatsapp/incoming-message.parser';
import type { IncomingWhatsAppMessage } from '../whatsapp/types/incoming-message.type';
import type { WhatsAppCredentials } from '../whatsapp/types/outgoing-message.type';
import { InboundMessageService } from './inbound-message.service';
import { normalizePhoneNumber } from './webhook-meta.util';
import type { Tenant } from '../tenants/entities/tenant.entity';

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

  private async resolveTenant(
    message: IncomingWhatsAppMessage,
  ): Promise<Tenant | null> {
    const normalizedDisplayPhone = message.displayPhoneNumber
      ? normalizePhoneNumber(message.displayPhoneNumber)
      : null;

    const tenant = normalizedDisplayPhone
      ? await this.tenantsService.findByWhatsappPhoneNumber(
          normalizedDisplayPhone,
        )
      : null;

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
