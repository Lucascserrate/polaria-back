import { Injectable, Logger } from '@nestjs/common';

import { TenantsService } from '../tenants/tenants.service';
import { parseIncomingWhatsAppMessage } from '../whatsapp/incoming-message.parser';
import type { IncomingWhatsAppMessage } from '../whatsapp/types/incoming-message.type';
import type { WhatsAppCredentials } from '../whatsapp/types/outgoing-message.type';
import { readStoredCredential } from '../whatsapp/utils/stored-credential.util';
import { InboundMessageService } from './inbound-message.service';
import {
  asObject,
  getArrayField,
  getObjectField,
  getStringField,
  normalizePhoneNumber,
  type JsonObject,
} from './webhook-meta.util';
import { AccountUpdateService } from './account-update.service';
import { TemplateStatusService } from './template-status.service';
import type { Tenant } from '../tenants/entities/tenant.entity';

/**
 * Campos que Meta solo entrega cuando el número está en Coexistence (app de
 * WhatsApp Business + Cloud API sobre el mismo número).
 *
 * Hoy no se ingieren: `parseIncomingWhatsAppMessage` los descarta porque no
 * traen `value.messages`. Se listan para poder distinguir en los logs un evento
 * de Coexistence de un webhook malformado.
 */
/** Eventos de la cuenta: conexión caída o restablecida desde el lado de Meta. */
const ACCOUNT_UPDATE_FIELD = 'account_update';

/** Aprobación o rechazo de una plantilla por parte de Meta. */
const TEMPLATE_STATUS_FIELD = 'message_template_status_update';

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
    private readonly accountUpdateService: AccountUpdateService,
    private readonly templateStatusService: TemplateStatusService,
  ) {}

  /**
   * Recorre todas las `entry` y todas sus `changes`.
   *
   * Meta agrupa varios eventos en un mismo POST. Mirando solo el primero, un
   * `account_update` que llegara segundo se perdía entero, y con él la única
   * señal de que la integración se cayó.
   */
  async handleIncomingWhatsAppWebhook(body: unknown): Promise<void> {
    const data = asObject(body);
    if (!data) return;

    const entries = getArrayField(data, 'entry') ?? [];

    for (const rawEntry of entries) {
      const entry = asObject(rawEntry);
      if (!entry) continue;

      const entryId = getStringField(entry, 'id');
      const entryTime = typeof entry.time === 'number' ? entry.time : null;
      const changes = getArrayField(entry, 'changes') ?? [];

      for (const rawChange of changes) {
        const change = asObject(rawChange);
        if (!change) continue;

        await this.handleChange({ data, entry, entryId, entryTime, change });
      }
    }
  }

  private async handleChange(params: {
    data: JsonObject;
    entry: JsonObject;
    entryId: string | null;
    entryTime: number | null;
    change: JsonObject;
  }): Promise<void> {
    const { data, entry, entryId, entryTime, change } = params;
    const field = getStringField(change, 'field');

    try {
      if (field === ACCOUNT_UPDATE_FIELD) {
        const value = getObjectField(change, 'value');
        if (!value) return;

        await this.accountUpdateService.handle({ entryId, entryTime, value });
        return;
      }

      if (field === TEMPLATE_STATUS_FIELD) {
        const value = getObjectField(change, 'value');
        if (!value) return;

        await this.templateStatusService.handle({ entryId, value });
        return;
      }

      if (field && COEXISTENCE_WEBHOOK_FIELDS.has(field)) {
        this.logger.log(`Webhook de Coexistence ignorado (field=${field}).`);
        return;
      }

      await this.handleMessageChange({ data, entry, change });
    } catch (error: unknown) {
      // Un cambio que falla no puede llevarse puestos a los demás del mismo POST.
      const errorMessage =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.logger.error(
        `Webhook processing error (field=${String(field)}): ${errorMessage}`,
      );
    }
  }

  /**
   * El parser lee `entry[0].changes[0]`, así que se le arma un cuerpo con este
   * único cambio.
   *
   * Reconstruirlo es más barato que cambiarle la firma: el parser está cubierto
   * por sus propias pruebas con cuerpos completos de Meta, y tocarlo para
   * soportar el reparto habría mezclado dos cambios en uno.
   */
  private async handleMessageChange(params: {
    data: JsonObject;
    entry: JsonObject;
    change: JsonObject;
  }): Promise<void> {
    const { data, entry, change } = params;

    const message = parseIncomingWhatsAppMessage({
      ...data,
      entry: [{ ...entry, changes: [change] }],
    });
    if (!message) return;

    const tenant = await this.resolveTenant(message);
    if (!tenant) return;

    const credentials = this.resolveCredentials(tenant, message);
    if (!credentials) return;

    this.logger.log(
      `Mensaje entrante (metaMessageId=${String(
        message.metaMessageId,
      )}, tenantId=${tenant.id}, from=${message.from}, kind=${message.kind}).`,
    );

    await this.inboundMessageService.handle({
      tenantId: tenant.id,
      credentials,
      message,
    });
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
    const accessToken = readStoredCredential(tenant.whatsappAccessToken);
    const phoneNumberId =
      readStoredCredential(tenant.whatsappPhoneId) ?? message.phoneNumberId;

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
