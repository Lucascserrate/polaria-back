import { Injectable, Logger } from '@nestjs/common';
import { AssistantService } from '../assistant/assistant.service';
import { TenantsService } from '../tenants/tenants.service';
import { parseIncomingWhatsAppMessage } from '../whatsapp/incoming-message.parser';
import {
  IncomingMessageKind,
  type IncomingWhatsAppMessage,
} from '../whatsapp/types/incoming-message.type';
import type { WhatsAppCredentials } from '../whatsapp/types/outgoing-message.type';
import { WhatsAppSenderService } from '../whatsapp/whatsapp-sender.service';
import { normalizePhoneNumber } from './webhook-meta.util';
import type { Tenant } from '../tenants/entities/tenant.entity';

const UNSUPPORTED_MESSAGE_REPLY = 'Hola 👋';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly tenantsService: TenantsService,
    private readonly assistantService: AssistantService,
    private readonly whatsAppSenderService: WhatsAppSenderService,
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

      await this.dispatch(message, tenant, credentials);
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

  private async dispatch(
    message: IncomingWhatsAppMessage,
    tenant: Tenant,
    credentials: WhatsAppCredentials,
  ): Promise<void> {
    const trace = `metaMessageId=${String(message.metaMessageId)}, tenantId=${
      tenant.id
    }, from=${message.from}`;

    switch (message.kind) {
      case IncomingMessageKind.TEXT: {
        this.logger.log(`Incoming WhatsApp text (${trace}): ${message.text}`);

        const { reply } = await this.assistantService.chat({
          tenantId: tenant.id,
          phone: message.from,
          clientName: message.contactName ?? undefined,
          messageText: message.text,
        });

        this.logger.log(`AI reply (${trace}): ${reply}`);
        await this.whatsAppSenderService.sendText(credentials, {
          to: message.from,
          body: reply,
        });
        return;
      }

      // Las respuestas interactivas son la entrada del flujo guiado de reservas.
      // Todavía no hay máquina de estados que las consuma, así que se registran
      // y se descartan; hoy es inalcanzable porque no enviamos componentes.
      case IncomingMessageKind.BUTTON_REPLY:
      case IncomingMessageKind.LIST_REPLY: {
        this.logger.log(
          `Incoming WhatsApp ${message.kind} (${trace}): selectionId=${message.selectionId}, title=${String(
            message.title,
          )}`,
        );
        return;
      }

      case IncomingMessageKind.FLOW_REPLY: {
        this.logger.log(
          `Incoming WhatsApp FLOW_REPLY (${trace}): flowToken=${String(
            message.flowToken,
          )}, parsed=${message.response ? 'yes' : 'no'}`,
        );
        if (!message.response && message.rawResponseJson) {
          this.logger.warn(
            `Flow response_json no parseable (${trace}): ${message.rawResponseJson}`,
          );
        }
        return;
      }

      case IncomingMessageKind.UNSUPPORTED: {
        this.logger.log(
          `Incoming WhatsApp unsupported message (${trace}): type=${String(
            message.messageType,
          )}`,
        );
        await this.whatsAppSenderService.sendText(credentials, {
          to: message.from,
          body: UNSUPPORTED_MESSAGE_REPLY,
        });
        return;
      }
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
