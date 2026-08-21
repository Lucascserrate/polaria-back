import { Injectable, Logger } from '@nestjs/common';

import { TenantsService } from '../tenants/tenants.service';
import {
  REMINDER_TEMPLATE_NAME,
  toReminderTemplateStatus,
} from '../whatsapp/reminder-template';
import { getStringField, type JsonObject } from './webhook-meta.util';

/**
 * Aprobación y rechazo de plantillas, informados por Meta.
 *
 * La revisión es asincrónica: la plantilla se crea en el momento de conectar y
 * Meta la aprueba minutos u horas después. Este webhook es el camino normal para
 * enterarse; el barrido de `ReminderTemplateStatusJob` es la red por si el campo
 * no está suscrito en el App Dashboard.
 *
 * Solo mira la plantilla de recordatorios. Si un negocio tiene otras plantillas
 * en su WABA, sus cambios de estado no son asunto de Polaria.
 */
@Injectable()
export class TemplateStatusService {
  private readonly logger = new Logger(TemplateStatusService.name);

  constructor(private readonly tenantsService: TenantsService) {}

  async handle(params: {
    /** `entry[].id`, que para estos eventos es una WABA. */
    entryId: string | null;
    value: JsonObject;
  }): Promise<void> {
    const { entryId, value } = params;

    const templateName = getStringField(value, 'message_template_name');
    if (templateName !== REMINDER_TEMPLATE_NAME) {
      this.logger.log(
        `Cambio de estado de una plantilla ajena, ignorado (name=${String(templateName)}).`,
      );
      return;
    }

    if (!entryId) return;

    const tenant = await this.tenantsService.findByWhatsappWabaId(entryId);
    if (!tenant) {
      this.logger.warn(
        `Estado de plantilla sin tenant que coincida (wabaId=${entryId}).`,
      );
      return;
    }

    // El estado nuevo viene en `event`, no en `status`.
    const metaStatus = getStringField(value, 'event');
    const status = toReminderTemplateStatus(metaStatus);

    await this.tenantsService.setReminderTemplate({
      tenantId: tenant.id,
      name: REMINDER_TEMPLATE_NAME,
      language:
        getStringField(value, 'message_template_language') ??
        tenant.reminderTemplateLanguage,
      status,
      metaStatus: metaStatus ?? null,
    });

    this.logger.log(
      `Plantilla de recordatorios en ${status} (tenantId=${tenant.id}, metaStatus=${String(metaStatus)}, reason=${String(getStringField(value, 'reason'))}).`,
    );
  }
}
