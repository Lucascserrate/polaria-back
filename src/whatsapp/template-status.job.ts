import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { readStoredCredential } from './utils/stored-credential.util';
import { WhatsAppTemplateService } from './whatsapp-template.service';
import {
  PROVISION_RETRY_HOURS,
  WhatsAppTemplatesRepository,
} from './whatsapp-templates.repository';
import { TemplateKey, TEMPLATE_KEYS } from './template-registry';
import { TemplateStatus } from './template-status';

/**
 * Cuántos negocios se aprovisionan por pasada.
 *
 * Acota el trabajo de una corrida: cada uno implica al menos una llamada a Graph, y
 * un despliegue con muchos negocios sin la plantilla nueva no debería producir un job
 * que tarda minutos. Lo que queda afuera entra en la pasada siguiente.
 */
const PROVISION_BATCH = 25;

/**
 * Mantiene al día las plantillas de cada negocio: las crea si faltan y relee su
 * estado mientras esperan revisión.
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
export class TemplateStatusJob implements OnModuleInit {
  private readonly logger = new Logger(TemplateStatusJob.name);

  constructor(
    private readonly templates: WhatsAppTemplatesRepository,
    private readonly whatsAppTemplateService: WhatsAppTemplateService,
  ) {}

  /**
   * Aprovisiona al arrancar, además de cada media hora.
   *
   * Sin esto, desplegar una plantilla nueva significa esperar hasta treinta minutos
   * sin saber si funcionó. Corre en segundo plano —no se espera— para no demorar el
   * arranque de la app por una llamada a Meta: si falla, el barrido siguiente lo
   * reintenta.
   *
   * Las migraciones ya corrieron en este punto: `migrationsRun` las ejecuta al
   * inicializar el DataSource, y ese módulo se inicializa antes que este.
   */
  onModuleInit(): void {
    void this.provisionMissing().catch(() => undefined);
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async run(): Promise<void> {
    // Primero crear lo que falta y después releer estados: una plantilla creada en
    // esta pasada queda en `PENDING`, y su aprobación se lee en la siguiente.
    await this.provisionMissing();
    await this.refreshPendingTemplates();
  }

  /**
   * Crea las plantillas que le falten a un negocio ya conectado.
   *
   * Es lo que hace que agregar una plantilla no obligue a nadie a desconectar y
   * reconectar WhatsApp. El aprovisionamiento normal sigue ocurriendo al conectar
   * —ver `provisionTemplates` en settings— y esto cubre a los que ya estaban.
   *
   * No toca la conexión: `provisionTemplate` solo consulta y crea plantillas en la
   * WABA, con las credenciales que el negocio ya tiene guardadas. Ninguna rama de
   * acá escribe en `tenants`.
   *
   * Es idempotente por consulta: `provisionTemplate` le pregunta a Meta si la
   * plantilla ya existe antes de crearla, así que una fila borrada a mano o un
   * negocio que la creó por su cuenta no producen un duplicado —se lee su estado y
   * se guarda—.
   */
  private async provisionMissing(): Promise<void> {
    const retryBefore = new Date(
      Date.now() - PROVISION_RETRY_HOURS * 60 * 60_000,
    );

    for (const key of TEMPLATE_KEYS) {
      try {
        const tenants = await this.templates.findConnectedMissing({
          templateKey: key,
          retryBefore,
          take: PROVISION_BATCH,
        });

        if (tenants.length === 0) continue;

        this.logger.log(
          `Negocios sin la plantilla ${key}: ${tenants.length}. Aprovisionando.`,
        );

        for (const tenant of tenants) {
          const wabaId = readStoredCredential(tenant.whatsappWabaId);
          const accessToken = readStoredCredential(tenant.whatsappAccessToken);

          /*
           * La consulta filtra `NULL` y cadena vacía, pero no `'null'` ni
           * `'undefined'`, que es lo que estas columnas pueden tener guardado. Acá
           * se vuelve a validar con la función que los reconoce todos.
           */
          if (!wabaId || !accessToken) continue;

          const state = await this.whatsAppTemplateService.provisionTemplate({
            tenantId: tenant.id,
            wabaId,
            accessToken,
            key,
          });

          /*
           * El fallo también se guarda, y ahí está la diferencia con el
           * aprovisionamiento del signup.
           *
           * Ahí no guardar significa "se intenta en la próxima conexión". Acá, no
           * guardar significa que la consulta lo devolvería en cada pasada: la fila
           * en `NOT_CREATED` es lo que da el punto de apoyo para esperar
           * `PROVISION_RETRY_HOURS` antes de volver a intentar.
           */
          await this.templates.save({
            tenantId: tenant.id,
            templateKey: key,
            name: state.name,
            language: state.language,
            status: state.status,
            metaStatus: state.metaStatus,
          });

          if (state.status === TemplateStatus.NOT_CREATED) {
            this.logger.warn(
              `No se pudo aprovisionar ${key} (tenantId=${tenant.id}). Se reintenta en ${PROVISION_RETRY_HOURS} h.`,
            );
            continue;
          }

          this.logger.log(
            `Plantilla ${key} aprovisionada en ${state.status} (tenantId=${tenant.id}).`,
          );
        }
      } catch (error: unknown) {
        this.logger.error(
          `Fallo al aprovisionar la plantilla ${key}: ${describeError(error)}`,
        );
      }
    }
  }

  private async refreshPendingTemplates(): Promise<void> {
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
        `Fallo al releer plantillas pendientes: ${describeError(error)}`,
      );
    }
  }
}

const describeError = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);
