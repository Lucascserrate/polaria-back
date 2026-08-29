import { StaffAlertEvent } from '../whatsapp/staff-alert-template';
import { BOOKABLE_STAFF_WHERE } from '../staff/staff-role';

/**
 * Quién tiene que enterarse de qué cuando una cita cambia. Todo acá es puro.
 *
 * Está separado del servicio por el mismo motivo que las reglas de recordatorios:
 * son las decisiones que hay que poder razonar sin base de datos ni WhatsApp de por
 * medio. El servicio decide *cuándo* preguntar; esto responde *a quién* y *qué*.
 */

/** Un tramo de la cita, en lo que le importa a una notificación. */
export interface NotifiableSegment {
  staffId: string | null;
  serviceId: string;
  startTime: Date;
}

/** Por qué un profesional no recibe el aviso. Se guarda para poder explicarlo. */
export const STAFF_NOTIFICATION_REASONS = {
  /** El tramo no tiene profesional cargado. */
  NO_STAFF: 'NO_STAFF',
  /** No atiende clientes, está inactivo o fue dado de baja. Ver §8. */
  STAFF_NOT_ELIGIBLE: 'STAFF_NOT_ELIGIBLE',
  /** No tiene teléfono: no hay a dónde escribir. */
  NO_STAFF_PHONE: 'NO_STAFF_PHONE',
  /** La plantilla del negocio no está aprobada todavía. */
  TEMPLATE_NOT_APPROVED: 'TEMPLATE_NOT_APPROVED',
  /** El negocio no tiene WhatsApp conectado. */
  NO_WHATSAPP_CONNECTION: 'NO_WHATSAPP_CONNECTION',
  /**
   * El negocio tiene los avisos automáticos apagados.
   *
   * Terminal, no en espera: volver a encenderlos no debe disparar el atraso de
   * mensajes de los días que estuvieron apagados. Quien los apagó no quiere
   * recibirlos después.
   */
  NOTIFICATIONS_DISABLED: 'NOTIFICATIONS_DISABLED',
  /** El proceso murió mientras hablaba con el canal. */
  SEND_INTERRUPTED: 'SEND_INTERRUPTED',
  /**
   * El evento guardado no corresponde a ninguna plantilla.
   *
   * Defensivo: cubre una fila escrita por una versión anterior o un dato tocado a
   * mano. Sin esto, la fila se quedaría `PENDING` para siempre y el barrido la
   * levantaría en cada pasada.
   */
  UNKNOWN_EVENT: 'UNKNOWN_EVENT',
} as const;

/**
 * Lo mínimo de un miembro del equipo para saber si puede recibir el aviso.
 *
 * Estructural a propósito: lo satisface la entidad `Staff` sin conversión, y a la
 * vez no ata esta regla a esa clase.
 */
export interface NotifiableStaff {
  id: string;
  isActive: boolean;
  providesServices: boolean;
  phone?: string | null;
  deletedAt?: Date | null;
}

/**
 * Si a este miembro del equipo le corresponde recibir avisos de citas.
 *
 * Deliberadamente **no** mira el rol. Un administrador que además atiende tiene que
 * enterarse de sus citas, y un profesional al que le apagaron "atiende clientes" no.
 * Lo que decide es lo mismo que decide si puede recibir una reserva —
 * `BOOKABLE_STAFF_WHERE`— más no estar dado de baja, que es la puerta que el rol no
 * cierra.
 *
 * El teléfono se evalúa aparte, en `resolveRecipient`, porque son dos negativas
 * distintas: "no le toca" y "no hay a dónde escribirle" mandan al negocio a resolver
 * cosas diferentes.
 */
export const isNotifiableStaff = (staff: NotifiableStaff): boolean =>
  staff.isActive === BOOKABLE_STAFF_WHERE.isActive &&
  staff.providesServices === BOOKABLE_STAFF_WHERE.providesServices &&
  !staff.deletedAt;

export type Recipient =
  | { kind: 'SEND'; phone: string }
  | { kind: 'SKIP'; reason: string };

/** Si se le puede escribir, y si no, por qué. */
export const resolveRecipient = (
  staff: NotifiableStaff | null | undefined,
): Recipient => {
  if (!staff) {
    return { kind: 'SKIP', reason: STAFF_NOTIFICATION_REASONS.NO_STAFF };
  }

  if (!isNotifiableStaff(staff)) {
    return {
      kind: 'SKIP',
      reason: STAFF_NOTIFICATION_REASONS.STAFF_NOT_ELIGIBLE,
    };
  }

  const phone = staff.phone?.trim();
  if (!phone) {
    return { kind: 'SKIP', reason: STAFF_NOTIFICATION_REASONS.NO_STAFF_PHONE };
  }

  return { kind: 'SEND', phone };
};

/** Un aviso que corresponde mandar, ya resuelto a quién y por qué. */
export interface PlannedNotification {
  staffId: string;
  event: StaffAlertEvent;
  /** El tramo de **esa** persona. Nunca los de los demás. Ver §3. */
  serviceId: string;
  startTime: Date;
  /**
   * Hora anterior de su tramo, solo en una reprogramación en la que cambió.
   *
   * `null` cuando cambió el día pero no la hora, o cuando no aplica: el mensaje
   * omite el "se movió de las X" en ese caso, en lugar de decir que se movió de la
   * misma hora a la misma hora.
   */
  previousStartTime: Date | null;
}

/**
 * Huella de lo que se notificó, para no repetirlo.
 *
 * Es la clave de la idempotencia y por eso incluye exactamente lo que el mensaje
 * dice: el instante y el servicio. De ahí salen las dos propiedades que hacen falta
 * al mismo tiempo:
 *
 * - **Reintentar la misma acción no manda dos mensajes.** El doble click, el retry
 *   de un webhook y la llamada repetida producen la misma huella, y el `upsert`
 *   sobre la clave única no hace nada.
 * - **Una segunda reprogramación real sí avisa.** Mover el turno otra vez produce
 *   otra huella, así que es otra fila.
 *
 * Con una clave de `(cita, profesional, evento)` a secas, la segunda reprogramación
 * habría quedado silenciada para siempre.
 */
export const notificationFingerprint = (
  notification: Pick<PlannedNotification, 'serviceId' | 'startTime'>,
): string =>
  `${notification.startTime.toISOString()}|${notification.serviceId}`;

/**
 * Qué avisos genera una cita nueva: uno por tramo.
 *
 * Un tramo por aviso y no un aviso por cita, porque cada profesional tiene que ver
 * **su** servicio y su hora. Si Juan hace el corte y Pedro la barba, el mensaje de
 * Juan no menciona la barba.
 *
 * Dos tramos del mismo profesional en la misma cita —corte y color con Diego— son
 * dos avisos, y está bien: son dos bloques distintos de su agenda.
 */
export const planCreated = (
  segments: NotifiableSegment[],
): PlannedNotification[] =>
  segments
    .filter((segment) => segment.staffId)
    .map((segment) => ({
      staffId: segment.staffId as string,
      event: StaffAlertEvent.CREATED,
      serviceId: segment.serviceId,
      startTime: segment.startTime,
      previousStartTime: null,
    }));

/** Qué avisos genera una cancelación: uno por tramo, a quien la tenía. */
export const planCancelled = (
  segments: NotifiableSegment[],
): PlannedNotification[] =>
  segments
    .filter((segment) => segment.staffId)
    .map((segment) => ({
      staffId: segment.staffId as string,
      event: StaffAlertEvent.CANCELLED,
      serviceId: segment.serviceId,
      startTime: segment.startTime,
      previousStartTime: null,
    }));

/**
 * Qué avisos genera una edición, comparando los tramos de antes con los de después.
 *
 * Es el caso que pidió el punto 11, y la razón por la que esto es un diff y no "la
 * cita cambió, avisemos a todos". Con Corte→Juan, Barba→Pedro pasando a
 * Corte→Juan, Barba→Carlos:
 *
 * - Pedro recibe **cancelada**: su participación se eliminó.
 * - Carlos recibe **nueva**: ahora tiene ese servicio.
 * - Juan **no recibe nada**: su tramo quedó idéntico.
 *
 * Ese último es el que importa. Avisarle a Juan de un cambio que no lo tocó es lo
 * que convierte las notificaciones en ruido que después nadie lee.
 *
 * El grano de la comparación es `(profesional, servicio)` y no el id del tramo,
 * porque `replaceSegments` los borra e inserta de nuevo: los ids son todos nuevos
 * después de cualquier edición, así que compararlos diría que todo cambió siempre.
 */
export const planEdited = (params: {
  before: NotifiableSegment[];
  after: NotifiableSegment[];
}): PlannedNotification[] => {
  const before = indexByStaffAndService(params.before);
  const after = indexByStaffAndService(params.after);

  const planned: PlannedNotification[] = [];

  for (const [key, segment] of after) {
    const previous = before.get(key);

    if (!previous) {
      planned.push({
        staffId: segment.staffId as string,
        event: StaffAlertEvent.CREATED,
        serviceId: segment.serviceId,
        startTime: segment.startTime,
        previousStartTime: null,
      });
      continue;
    }

    // Su tramo quedó igual: no hay nada que avisarle.
    if (previous.startTime.getTime() === segment.startTime.getTime()) continue;

    planned.push({
      staffId: segment.staffId as string,
      event: StaffAlertEvent.RESCHEDULED,
      serviceId: segment.serviceId,
      startTime: segment.startTime,
      previousStartTime: previous.startTime,
    });
  }

  for (const [key, segment] of before) {
    if (after.has(key)) continue;

    planned.push({
      staffId: segment.staffId as string,
      event: StaffAlertEvent.CANCELLED,
      serviceId: segment.serviceId,
      startTime: segment.startTime,
      previousStartTime: null,
    });
  }

  return planned;
};

const indexByStaffAndService = (
  segments: NotifiableSegment[],
): Map<string, NotifiableSegment> =>
  new Map(
    segments
      .filter((segment) => segment.staffId)
      .map((segment) => [`${segment.staffId}|${segment.serviceId}`, segment]),
  );
