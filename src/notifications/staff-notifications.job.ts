import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { currentImpersonation } from '../auth/impersonation';
import { Service } from '../services/entities/service.entity';
import { readStoredCredential } from '../whatsapp/utils/stored-credential.util';
import { WhatsAppSenderService } from '../whatsapp/whatsapp-sender.service';
import { WhatsAppTemplatesRepository } from '../whatsapp/whatsapp-templates.repository';
import { templateHasUrlButton } from '../whatsapp/template-registry';
import { canSendTemplate } from '../whatsapp/template-status';
import {
  buildStaffAlertParameters,
  StaffAlertEvent,
  TEMPLATE_KEY_BY_EVENT,
} from '../whatsapp/staff-alert-template';
import type { AppointmentNotification } from './entities/appointment-notification.entity';
import {
  formatAlertDate,
  formatAlertDateKey,
  formatAlertTime,
} from './staff-alert-message';
import {
  resolveRecipient,
  STAFF_NOTIFICATION_REASONS,
} from './staff-notification.rules';
import { StaffNotificationsRepository } from './staff-notifications.repository';

/** Techo por pasada. Ver `findPending`. */
const BATCH_SIZE = 50;

/**
 * Cuánto puede tardar un envío antes de considerarse interrumpido.
 *
 * Holgado por lo mismo que en recordatorios: una llamada HTTP sin timeout puede
 * tardar, y cerrar demasiado pronto un envío que sí está en curso sería marcar como
 * fallido algo que llegó.
 */
const SENDING_TIMEOUT_MINUTES = 15;

/**
 * Envía los avisos encolados a los profesionales.
 *
 * Dos caminos hacia el mismo método, y de ahí sale el compromiso entre inmediatez y
 * durabilidad:
 *
 * - `flush()` lo llama el propio request que acaba de modificar la cita, así que en
 *   el caso normal el profesional se entera en segundos.
 * - el cron lo llama cada minuto, y recoge lo que quedó `PENDING` porque el proceso
 *   murió, porque Meta estaba caído o porque la plantilla todavía no estaba aprobada
 *   cuando se encoló.
 *
 * Que los dos puedan correr a la vez sin duplicar mensajes lo garantiza `claim`: la
 * condición `state = PENDING` viaja dentro del `UPDATE`, así que la base elige un
 * solo ganador por fila.
 *
 * Hay un tercer caso: desde una sesión de soporte `flush` no hace nada y queda todo
 * para el cron. La cola es global, así que vaciarla desde ahí afectaba a otros
 * negocios; está explicado en `flush`.
 */
@Injectable()
export class StaffNotificationsJob {
  private readonly logger = new Logger(StaffNotificationsJob.name);

  constructor(
    private readonly repository: StaffNotificationsRepository,
    private readonly templates: WhatsAppTemplatesRepository,
    private readonly sender: WhatsAppSenderService,
    @InjectRepository(Service)
    private readonly services: Repository<Service>,
    private readonly configService: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    try {
      const stale = await this.repository.failStale({
        olderThan: new Date(Date.now() - SENDING_TIMEOUT_MINUTES * 60_000),
        reason: STAFF_NOTIFICATION_REASONS.SEND_INTERRUPTED,
      });
      if (stale > 0) {
        this.logger.warn(
          `Avisos interrumpidos cerrados como fallidos: ${stale}.`,
        );
      }
    } catch (error: unknown) {
      this.logger.error(
        `Fallo al cerrar avisos interrumpidos: ${describeError(error)}`,
      );
    }

    await this.flush();
  }

  /**
   * Despacha lo pendiente. Nunca lanza.
   *
   * La llama el cron y también el request que acaba de tocar la cita. En el segundo
   * caso es a propósito que no lance: la operación principal ya terminó bien.
   */
  async flush(): Promise<void> {
    /*
     * Desde una sesión de soporte no se despacha: lo hace el cron un minuto
     * después.
     *
     * No es por prudencia, es por un daño concreto. La cola es **global**, no
     * del negocio que se está mirando: `findPending` trae lo más viejo de todos
     * los tenants. Como el request que toca una cita llama a `flush`, mover una
     * cita mientras se suplanta a una barbería vaciaba la cola de *las demás*,
     * y el bloqueo de envíos las devolvía como `IMPERSONATION_BLOCKED` — que
     * `dispatch` guarda con `markFailed`, o sea para siempre. Avisos de otros
     * negocios perdidos en silencio.
     *
     * Saltearlo no pierde nada: la fila queda `PENDING` y el barrido de cada
     * minuto la toma. Lo único que se resigna es el despacho inmediato, que
     * existe para que el profesional se entere en segundos, y eso no hace falta
     * cuando quien tocó la cita fue soporte.
     */
    const impersonation = currentImpersonation();
    if (impersonation) {
      this.logger.log(
        `Despacho de avisos postergado al cron: sesión de soporte (by=${impersonation.by}, tenantId=${impersonation.tenantId}).`,
      );
      return;
    }

    try {
      const pending = await this.repository.findPending(BATCH_SIZE);

      for (const notification of pending) {
        await this.dispatch(notification);
      }
    } catch (error: unknown) {
      this.logger.error(`Fallo al despachar avisos: ${describeError(error)}`);
    }
  }

  private async dispatch(notification: AppointmentNotification): Promise<void> {
    const { tenant, staff, appointment } = notification;

    /*
     * Las tres negativas se registran en la fila y no solo en el log.
     *
     * Es lo que hace que la ausencia de un mensaje sea explicable: quien mira la
     * fila ve si no se envió porque el profesional no tiene teléfono, porque no le
     * corresponde, o porque el negocio todavía no tiene la plantilla aprobada.
     */
    const recipient = resolveRecipient(staff);
    if (recipient.kind === 'SKIP') {
      await this.skip(notification, recipient.reason);
      return;
    }

    /*
     * El interruptor del negocio.
     *
     * Va antes que las credenciales porque es una decisión suya y no una falla: si
     * los apagó, no corresponde avisarle que le falta algo.
     */
    if (!tenant?.whatsappNotificationsEnabled) {
      await this.skip(
        notification,
        STAFF_NOTIFICATION_REASONS.NOTIFICATIONS_DISABLED,
      );
      return;
    }

    const accessToken = readStoredCredential(tenant?.whatsappAccessToken);
    const phoneNumberId = readStoredCredential(tenant?.whatsappPhoneId);

    if (!accessToken || !phoneNumberId) {
      await this.skip(
        notification,
        STAFF_NOTIFICATION_REASONS.NO_WHATSAPP_CONNECTION,
      );
      return;
    }

    /*
     * Cada evento tiene su plantilla. La traducción vive en
     * `TEMPLATE_KEY_BY_EVENT`, así que acá no hay `switch`.
     */
    const templateKey =
      TEMPLATE_KEY_BY_EVENT[notification.event as StaffAlertEvent];

    if (!templateKey) {
      // Un evento que no reconocemos: fila vieja o dato corrupto. No se manda nada.
      await this.skip(notification, STAFF_NOTIFICATION_REASONS.UNKNOWN_EVENT);
      return;
    }

    const template = await this.templates.find(
      notification.tenantId,
      templateKey,
    );

    /*
     * La plantilla sin aprobar **no** cierra la fila.
     *
     * Se deja `PENDING` para que el barrido lo reintente cuando Meta apruebe. Es
     * transitorio por naturaleza —la aprobación tarda minutos u horas— y cerrarlo
     * como salteado condenaría a todos los avisos del primer día de un negocio.
     */
    if (!template || !canSendTemplate(template.status)) {
      this.logger.log(
        `Aviso en espera de la plantilla ${templateKey} (tenantId=${notification.tenantId}, status=${String(template?.status)}).`,
      );
      return;
    }

    if (!(await this.repository.claim(notification.id))) {
      // Otro camino —el cron o el request— la tomó primero.
      return;
    }

    const serviceName = await this.serviceName(notification.serviceId);
    const timezone = tenant?.timezone ?? 'America/La_Paz';

    const parameters = buildStaffAlertParameters({
      clientName: appointment?.client?.name ?? null,
      serviceName,
      date: formatAlertDate(notification.startTime, timezone),
      time: formatAlertTime(notification.startTime, timezone),
    });

    const result = await this.sender.sendTemplate(
      { accessToken, phoneNumberId },
      {
        to: recipient.phone,
        name: template.name,
        languageCode: template.language,
        bodyParameters: parameters,
        quickReplyPayloads: [],
        /*
         * El sufijo solo viaja si la plantilla declara el botón.
         *
         * La de cancelada no lo lleva —la cita ya no existe, así que "ver mi agenda"
         * no explicaría nada— y mandar un parámetro de botón a una plantilla sin
         * botones hace que Meta rechace el envío.
         */
        /*
         * El sufijo se manda solo si la plantilla se **creó** con botón.
         *
         * Se pregunta con la misma entrada que usó la creación —`CLIENT_BASE_URL`—
         * porque sin ella el botón se omite al crear, y mandarle un parámetro de
         * botón a una plantilla que no lo tiene hace que Meta rechace el envío.
         */
        ...(templateHasUrlButton(templateKey, this.clientBaseUrl())
          ? {
              urlButtonSuffix: formatAlertDateKey(
                notification.startTime,
                timezone,
              ),
            }
          : {}),
      },
    );

    if (!result.ok) {
      await this.repository.markFailed(
        notification.id,
        result.error ?? 'SEND_FAILED',
      );
      this.logger.error(
        `Aviso no entregado (notificationId=${notification.id}, staffId=${notification.staffId}): ${String(result.error)}`,
      );
      return;
    }

    await this.repository.markSent({
      id: notification.id,
      sentAt: new Date(),
      metaMessageId: result.metaMessageId ?? null,
    });

    this.logger.log(
      `Aviso enviado (notificationId=${notification.id}, event=${notification.event}, staffId=${notification.staffId}).`,
    );
  }

  private async skip(
    notification: AppointmentNotification,
    reason: string,
  ): Promise<void> {
    await this.repository.markSkipped(notification.id, reason);

    /*
     * En `warn` y no en `log`: los tres motivos que llegan acá —sin teléfono, no
     * atiende clientes, sin conexión— son configuraciones que alguien tiene que
     * arreglar, no eventos normales. Mezclados con el resto del flujo se pierden, y
     * desde afuera "no llegó el aviso" se ve idéntico a que el sistema esté roto.
     */
    this.logger.warn(
      `Aviso NO enviado (notificationId=${notification.id}, staffId=${notification.staffId}, event=${notification.event}, motivo=${reason}).`,
    );
  }

  /**
   * El nombre del servicio, o `null` si el negocio lo borró.
   *
   * Se consulta al enviar y no se guarda al encolar porque el mensaje tiene que
   * decir cómo se llama **hoy**: entre encolar y enviar pasan segundos, pero un
   * aviso que espera la aprobación de la plantilla puede esperar horas.
   */
  /** La misma base que usó el aprovisionamiento. Ver `templateHasUrlButton`. */
  private clientBaseUrl(): string | undefined {
    return this.configService.get<string>('CLIENT_BASE_URL') ?? undefined;
  }

  private async serviceName(serviceId: string): Promise<string | null> {
    const service = await this.services.findOne({
      where: { id: serviceId },
      select: { id: true, name: true },
    });

    return service?.name ?? null;
  }
}

const describeError = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);
