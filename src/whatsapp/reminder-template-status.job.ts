import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { TenantsService } from '../tenants/tenants.service';
import { readStoredCredential } from './utils/stored-credential.util';
import { WhatsAppTemplateService } from './whatsapp-template.service';

/**
 * Relee el estado de las plantillas que siguen esperando revisión.
 *
 * Es una red de seguridad, no el camino normal: lo normal es que Meta avise por
 * el webhook `message_template_status_update`. Pero ese campo se suscribe en el
 * App Dashboard, y si no está tildado la plantilla se queda en `PENDING` para
 * siempre y **los recordatorios no salen nunca, sin ningún error visible**. Ese
 * modo de fallar silencioso es lo que justifica el barrido.
 *
 * Cada media hora alcanza: una aprobación tarda minutos u horas, y esto solo
 * consulta a los negocios que están esperando.
 */
@Injectable()
export class ReminderTemplateStatusJob {
  private readonly logger = new Logger(ReminderTemplateStatusJob.name);

  constructor(
    private readonly tenantsService: TenantsService,
    private readonly whatsAppTemplateService: WhatsAppTemplateService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async refreshPendingTemplates(): Promise<void> {
    try {
      const tenants =
        await this.tenantsService.findWithPendingReminderTemplate();
      if (tenants.length === 0) return;

      for (const tenant of tenants) {
        const wabaId = readStoredCredential(tenant.whatsappWabaId);
        const accessToken = readStoredCredential(tenant.whatsappAccessToken);

        // Sin conexión no hay a quién preguntar. Puede pasar si el negocio
        // desconectó mientras la plantilla estaba en revisión.
        if (!wabaId || !accessToken) continue;

        const state =
          await this.whatsAppTemplateService.refreshReminderTemplate({
            tenantId: tenant.id,
            wabaId,
            accessToken,
          });

        if (!state || state.status === tenant.reminderTemplateStatus) continue;

        await this.tenantsService.setReminderTemplate({
          tenantId: tenant.id,
          name: state.name,
          language: state.language,
          status: state.status,
          metaStatus: state.metaStatus,
        });

        this.logger.log(
          `Plantilla de recordatorios pasó a ${state.status} (tenantId=${tenant.id}, metaStatus=${String(state.metaStatus)}).`,
        );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.logger.error(`Fallo al releer plantillas pendientes: ${message}`);
    }
  }
}
