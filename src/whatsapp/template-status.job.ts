import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { readStoredCredential } from './utils/stored-credential.util';
import { WhatsAppTemplateService } from './whatsapp-template.service';
import { WhatsAppTemplatesRepository } from './whatsapp-templates.repository';
import { TemplateKey } from './template-registry';

/**
 * Relee el estado de las plantillas que siguen esperando revisión.
 *
 * Es una red de seguridad, no el camino normal: lo normal es que Meta avise por el
 * webhook `message_template_status_update`. Pero ese campo se suscribe en el App
 * Dashboard, y si no está tildado la plantilla se queda en `PENDING` para siempre y
 * **los mensajes no salen nunca, sin ningún error visible**. Ese modo de fallar
 * silencioso es lo que justifica el barrido.
 *
 * Cada media hora alcanza: una aprobación tarda minutos u horas, y esto solo
 * consulta a los negocios que están esperando.
 *
 * Antes esto sabía de una sola plantilla. Ahora itera filas, así que agregar la
 * cuarta plantilla no le agrega una rama.
 */
@Injectable()
export class TemplateStatusJob {
  private readonly logger = new Logger(TemplateStatusJob.name);

  constructor(
    private readonly templates: WhatsAppTemplatesRepository,
    private readonly whatsAppTemplateService: WhatsAppTemplateService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async refreshPendingTemplates(): Promise<void> {
    try {
      const pending = await this.templates.findPending();
      if (pending.length === 0) return;

      for (const template of pending) {
        const { tenant } = template;
        if (!tenant) continue;

        const wabaId = readStoredCredential(tenant.whatsappWabaId);
        const accessToken = readStoredCredential(tenant.whatsappAccessToken);

        // Sin conexión no hay a quién preguntar. Puede pasar si el negocio
        // desconectó mientras la plantilla estaba en revisión.
        if (!wabaId || !accessToken) continue;

        const state = await this.whatsAppTemplateService.refreshTemplate({
          tenantId: tenant.id,
          wabaId,
          accessToken,
          key: template.templateKey as TemplateKey,
        });

        // `String(...)` porque la columna es `varchar` y el estado un enum: sin
        // esto, comparar los dos es un error de tipos y no una comparación.
        if (!state || String(state.status) === template.status) continue;

        await this.templates.save({
          tenantId: tenant.id,
          templateKey: template.templateKey as TemplateKey,
          name: state.name,
          language: state.language,
          status: state.status,
          metaStatus: state.metaStatus,
        });

        this.logger.log(
          `Plantilla ${template.templateKey} pasó a ${state.status} (tenantId=${tenant.id}, metaStatus=${String(state.metaStatus)}).`,
        );
      }
    } catch (error: unknown) {
      this.logger.error(
        `Fallo al releer plantillas pendientes: ${
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error)
        }`,
      );
    }
  }
}
