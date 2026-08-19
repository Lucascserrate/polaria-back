import { Injectable, Logger } from '@nestjs/common';

import { TenantsService } from '../tenants/tenants.service';
import { readStoredCredential } from '../whatsapp/utils/stored-credential.util';
import {
  getObjectField,
  getStringField,
  type JsonObject,
} from './webhook-meta.util';

/**
 * Eventos que dejan la conexión fuera de servicio.
 *
 * `PARTNER_REMOVED` es el negocio desvinculando la cuenta de nuestra app;
 * `ACCOUNT_OFFBOARDED`, un cambio de dispositivo o un re-registro del número.
 */
const UNAVAILABLE_EVENTS = new Set(['PARTNER_REMOVED', 'ACCOUNT_OFFBOARDED']);

/** Eventos que la devuelven al aire sin intervención del negocio. */
const RECOVERED_EVENTS = new Set(['ACCOUNT_RECONNECTED', 'PARTNER_ADDED']);

/**
 * Sincroniza el estado de la conexión con lo que pasa del lado de Meta.
 *
 * Es el complemento de la desconexión manual, y hace lo contrario: **no borra
 * credenciales**. Estas caídas se revierten solas —un teléfono apagado unos
 * días—, y si borráramos el token, `ACCOUNT_RECONNECTED` no tendría nada que
 * restaurar y el negocio quedaría obligado a rehacer el Embedded Signup por algo
 * que Meta ya resolvió.
 */
@Injectable()
export class AccountUpdateService {
  private readonly logger = new Logger(AccountUpdateService.name);

  constructor(private readonly tenantsService: TenantsService) {}

  async handle(params: {
    /** `entry[].id`, que para estos eventos es una WABA. */
    entryId: string | null;
    /** `entry[].time`, en segundos. */
    entryTime: number | null;
    value: JsonObject;
  }): Promise<void> {
    const { entryId, entryTime, value } = params;

    const event = getStringField(value, 'event');
    if (!event) return;

    const wabaInfo = getObjectField(value, 'waba_info');
    // La documentación de Meta muestra un ejemplo de `PARTNER_REMOVED` donde
    // `entry[].id` y `waba_info.waba_id` son distintos, sin explicar por qué. Se
    // prueban los dos antes de dar el evento por ajeno.
    const wabaIds = [
      wabaInfo ? getStringField(wabaInfo, 'waba_id') : null,
      entryId,
    ].filter((id): id is string => Boolean(id));

    const isUnavailable = UNAVAILABLE_EVENTS.has(event);
    const isRecovered = RECOVERED_EVENTS.has(event);

    if (!isUnavailable && !isRecovered) {
      // Baneos, violaciones y cambios de tarifa entran por el mismo campo. Se
      // registran para poder verlos, pero no tocan el estado de la conexión.
      this.logger.log(
        `account_update sin efecto (event=${event}, wabaIds=${wabaIds.join('|')}).`,
      );
      return;
    }

    const tenant = await this.findTenant(wabaIds);
    if (!tenant) {
      this.logger.warn(
        `account_update descartado: ninguna WABA coincide (event=${event}, wabaIds=${wabaIds.join('|')}).`,
      );
      return;
    }

    // Sin credenciales no hay conexión que marcar. Cubre el caso de un evento
    // que llega después de que el negocio desconectó desde el panel.
    if (!readStoredCredential(tenant.whatsappAccessToken)) {
      this.logger.log(
        `account_update ignorado: el tenant no tiene conexión activa (tenantId=${tenant.id}, event=${event}).`,
      );
      return;
    }

    const eventAt = entryTime ? new Date(entryTime * 1000) : null;

    // Los webhooks se reintentan y llegan desordenados. Un evento anterior a la
    // conexión vigente habla de una conexión que ya fue reemplazada, y aplicarlo
    // tumbaría una que está sana.
    if (
      eventAt &&
      tenant.whatsappConnectedAt &&
      eventAt < tenant.whatsappConnectedAt
    ) {
      this.logger.log(
        `account_update ignorado por antigüedad (tenantId=${tenant.id}, event=${event}, eventAt=${eventAt.toISOString()}, connectedAt=${tenant.whatsappConnectedAt.toISOString()}).`,
      );
      return;
    }

    if (isRecovered) {
      await this.tenantsService.setWhatsappUnavailability({
        tenantId: tenant.id,
        since: null,
        reason: null,
      });
      this.logger.log(
        `Conexión de WhatsApp restablecida por Meta (tenantId=${tenant.id}, event=${event}).`,
      );
      return;
    }

    const disconnectionInfo = getObjectField(value, 'disconnection_info');
    // `disconnection_info` solo viene cuando el negocio usaba la app de WhatsApp
    // Business y Cloud API a la vez. Fuera de Coexistence no hay motivo y se
    // guarda el propio evento, que es más útil que un `NULL`.
    const reason =
      (disconnectionInfo
        ? getStringField(disconnectionInfo, 'reason')
        : null) ?? event;

    await this.tenantsService.setWhatsappUnavailability({
      tenantId: tenant.id,
      since: eventAt ?? new Date(),
      reason,
    });

    this.logger.warn(
      `Conexión de WhatsApp caída (tenantId=${tenant.id}, event=${event}, reason=${reason}, initiatedBy=${String(
        disconnectionInfo
          ? getStringField(disconnectionInfo, 'initiated_by')
          : null,
      )}).`,
    );
  }

  private async findTenant(wabaIds: string[]) {
    for (const wabaId of wabaIds) {
      const tenant = await this.tenantsService.findByWhatsappWabaId(wabaId);
      if (tenant) return tenant;
    }
    return null;
  }
}
