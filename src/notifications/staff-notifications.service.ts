import { Injectable, Logger } from '@nestjs/common';

import { AppointmentStatus } from '../appointments/entities/appointment.entity';
import { StaffAlertEvent } from '../whatsapp/staff-alert-template';
import { NotificationState } from './notification-state';
import {
  NOTIFICATION_CHANNEL_WHATSAPP,
  StaffNotificationsRepository,
} from './staff-notifications.repository';
import {
  notificationFingerprint,
  planCancelled,
  planCreated,
  planEdited,
  type NotifiableSegment,
  type PlannedNotification,
} from './staff-notification.rules';

/** Un tramo tal como lo tienen los llamadores. Se normaliza acá. */
export interface SegmentInput {
  staffId: string | null;
  serviceId: string;
  startTime: Date;
}

/**
 * Encola los avisos que le corresponden a cada profesional cuando una cita cambia.
 *
 * **Nada de acá habla con WhatsApp.** Escribe filas y termina, y eso es lo que hace
 * cumplible la regla de que un fallo del canal no puede deshacer una reserva: el
 * envío lo hace `StaffNotificationsJob`, después, sobre lo encolado.
 *
 * Todos los métodos son a prueba de fallos por la misma razón. Un error acá se
 * registra y se traga: la cita ya está creada, o cancelada, o movida, y volver eso
 * atrás porque no se pudo escribir un aviso sería cambiar un problema de
 * notificación por uno de agenda.
 */
@Injectable()
export class StaffNotificationsService {
  private readonly logger = new Logger(StaffNotificationsService.name);

  constructor(private readonly repository: StaffNotificationsRepository) {}

  /** Una cita nueva: un aviso por tramo. */
  async appointmentCreated(params: {
    tenantId: string;
    appointmentId: string;
    segments: SegmentInput[];
  }): Promise<void> {
    await this.enqueue(
      { ...params, operacion: 'creada', tramos: params.segments.length },
      planCreated(toNotifiable(params.segments)),
    );
  }

  /**
   * Una cita editada: el diff decide quién se entera de qué.
   *
   * Recibe los tramos de antes y los de después porque es la única forma de
   * distinguir a quien se le movió el turno de quien quedó igual. Ver `planEdited`.
   */
  async appointmentEdited(params: {
    tenantId: string;
    appointmentId: string;
    before: SegmentInput[];
    after: SegmentInput[];
  }): Promise<void> {
    await this.enqueue(
      {
        ...params,
        operacion: 'editada',
        tramos: params.after.length,
      },
      planEdited({
        before: toNotifiable(params.before),
        after: toNotifiable(params.after),
      }),
    );
  }

  /** Una cita cancelada: un aviso por tramo, a quien la tenía. */
  async appointmentCancelled(params: {
    tenantId: string;
    appointmentId: string;
    segments: SegmentInput[];
  }): Promise<void> {
    await this.enqueue(
      { ...params, operacion: 'cancelada', tramos: params.segments.length },
      planCancelled(toNotifiable(params.segments)),
    );
  }

  /**
   * Un cambio de estado que puede ser una cancelación, o no.
   *
   * Existe porque el panel cambia el estado con un solo endpoint: `completed` y
   * `cancelled` llegan por el mismo camino, y solo el segundo se avisa. Marcar una
   * cita como atendida no es novedad para quien la atendió.
   */
  async appointmentStatusChanged(params: {
    tenantId: string;
    appointmentId: string;
    status: AppointmentStatus;
    segments: SegmentInput[];
  }): Promise<void> {
    if (params.status !== AppointmentStatus.CANCELLED) return;

    await this.appointmentCancelled(params);
  }

  /**
   * Una cita que se borra físicamente.
   *
   * Solo avisa a quienes **ya recibieron** el aviso de que existía. El borrado
   * físico es la herramienta para lo que nunca debió existir —una prueba, una carga
   * duplicada— y mandarle un "se canceló" a alguien que nunca supo de esa cita es
   * ruido sobre algo que para él no ocurrió. Si en cambio ya se le avisó, hay que
   * desdecirlo.
   *
   * Los avisos se leen antes de borrar por necesidad: la clave foránea está en
   * cascada y se los lleva con la cita.
   */
  async appointmentDeleted(params: {
    tenantId: string;
    appointmentId: string;
    segments: SegmentInput[];
  }): Promise<void> {
    try {
      const alreadyTold = await this.repository.findSentFor(
        params.appointmentId,
      );

      if (alreadyTold.length === 0) return;

      const informed = new Set(alreadyTold.map((row) => row.staffId));

      await this.appointmentCancelled({
        ...params,
        segments: params.segments.filter(
          (segment) => segment.staffId && informed.has(segment.staffId),
        ),
      });
    } catch (error: unknown) {
      this.logger.error(
        `No se pudieron encolar los avisos de un borrado (appointmentId=${params.appointmentId}): ${describeError(error)}`,
      );
    }
  }

  /**
   * Escribe las filas.
   *
   * El `try/catch` que se traga todo es deliberado y es la garantía del punto 9: la
   * operación principal ya terminó bien, y nada de lo que pase acá puede cambiar eso.
   * Se registra en `error` porque nadie lo nota desde afuera —la cita se ve
   * correcta— y el log es la única forma de enterarse.
   *
   * La elegibilidad del profesional **no** se evalúa acá sino al despachar. Encolar
   * primero y filtrar después es lo que permite responder "no se envió porque no
   * tiene teléfono": si se filtrara antes, no quedaría fila que lo explicara y la
   * ausencia del mensaje sería un silencio.
   */
  private async enqueue(
    params: {
      tenantId: string;
      appointmentId: string;
      /** Qué le pasó a la cita. Solo para el log. */
      operacion: string;
      /** Cuántos tramos entraron. Solo para el log. */
      tramos: number;
    },
    planned: PlannedNotification[],
  ): Promise<void> {
    /*
     * Que no haya nada que avisar **también se registra**.
     *
     * Es el punto ciego que costó una sesión entera de depuración: sin esta línea,
     * "el disparador corrió y decidió que no le tocaba a nadie" y "el disparador
     * nunca corrió" se ven exactamente igual desde el log —silencio— y son dos
     * problemas opuestos.
     *
     * Pasa legítimamente en una edición que no movió el tramo de nadie, y también
     * cuando la cita no tiene profesional asignado.
     */
    if (planned.length === 0) {
      this.logger.log(
        `Sin avisos que encolar (appointmentId=${params.appointmentId}, operacion=${params.operacion}, tramos=${params.tramos}).`,
      );
      return;
    }

    try {
      await this.repository.enqueue(
        planned.map((notification) => ({
          tenantId: params.tenantId,
          appointmentId: params.appointmentId,
          staffId: notification.staffId,
          event: notification.event,
          fingerprint: notificationFingerprint(notification),
          serviceId: notification.serviceId,
          startTime: notification.startTime,
          previousStartTime: notification.previousStartTime,
          channel: NOTIFICATION_CHANNEL_WHATSAPP,
          state: NotificationState.PENDING,
          failureReason: null,
          sentAt: null,
          metaMessageId: null,
        })),
      );

      /*
       * Se nombra a quién, no solo cuántos.
       *
       * Con dos profesionales en una cita, saber que se encolaron dos avisos no
       * alcanza para seguirlos: los `staffId` son lo que permite emparejar esta línea
       * con la de envío o la de salteado que viene después.
       */
      this.logger.log(
        `Avisos encolados (appointmentId=${params.appointmentId}, operacion=${params.operacion}, cantidad=${planned.length}, eventos=${describeEvents(planned)}, staff=${planned.map((n) => n.staffId).join(',')}).`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `No se pudieron encolar los avisos (appointmentId=${params.appointmentId}): ${describeError(error)}`,
      );
    }
  }
}

const toNotifiable = (segments: SegmentInput[]): NotifiableSegment[] =>
  segments.map((segment) => ({
    staffId: segment.staffId,
    serviceId: segment.serviceId,
    startTime: segment.startTime,
  }));

const describeEvents = (planned: PlannedNotification[]): string => {
  const counts = new Map<StaffAlertEvent, number>();
  for (const notification of planned) {
    counts.set(notification.event, (counts.get(notification.event) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([event, count]) => `${event}:${count}`)
    .join(' ');
};

const describeError = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);
