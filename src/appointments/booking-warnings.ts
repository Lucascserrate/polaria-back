import { isWithinWorkingRanges } from '../availability/utils/working-hours.resolver';
import type { SlotRange } from '../availability/utils/availability.types';

/**
 * Qué tiene de raro un horario que el panel pidió explícitamente.
 *
 * Es la contracara del motor de disponibilidad, y la distinción importa. El motor
 * responde *"¿qué le puedo ofrecer a un cliente?"* y por eso descarta todo lo que
 * no sea ofrecible. El panel es otra pregunta: *"el administrador pidió
 * exactamente esto, ¿qué problemas tiene?"*. Registrar una atención que ya
 * ocurrió, o una excepción fuera de horario, es trabajo legítimo del dueño del
 * negocio y no puede resolverse con la lista de horarios que se le muestra a un
 * cliente por WhatsApp.
 *
 * Todo lo de acá **advierte**, no impide. Los bloqueos siguen siendo los de
 * siempre: servicios que no existen, duraciones inválidas, un profesional que no
 * hace ese servicio, y el índice único de la base.
 *
 * Puro a propósito: son reglas que hay que poder leer y probar sin base ni reloj
 * real.
 */

export enum BookingWarningCode {
  /** El horario ya pasó. */
  PAST_TIME = 'PAST_TIME',
  /** Ese día el negocio no atiende. */
  CLOSED_DAY = 'CLOSED_DAY',
  /** El negocio abre ese día, pero no a esa hora. */
  OUTSIDE_BUSINESS_HOURS = 'OUTSIDE_BUSINESS_HOURS',
  /** El negocio está abierto a esa hora, pero ese profesional no trabaja. */
  STAFF_OFF_SHIFT = 'STAFF_OFF_SHIFT',
  /** Ese profesional ya tiene otra cita que se pisa con esta. */
  STAFF_BUSY = 'STAFF_BUSY',
  /** Alguien marcó esa franja como no disponible. */
  TIME_BLOCKED = 'TIME_BLOCKED',
}

export interface BookingWarning {
  code: BookingWarningCode;
  /**
   * Texto listo para mostrar.
   *
   * Viaja armado desde acá para que la pantalla no tenga que reconstruir la
   * regla: si el mensaje se escribiera en el frontend, cambiar la regla dejaría
   * un texto que ya no la describe.
   */
  message: string;
  /** Presente cuando la advertencia es de un profesional en particular. */
  staffId?: string;
}

/** Un tramo de la reserva pedida, con quién lo atiende. */
export interface RequestedSegment extends SlotRange {
  staffId: string;
  staffName?: string | null;
}

/**
 * Una franja marcada como no disponible, tal como está guardada.
 *
 * Llega **sin repartir** entre profesionales, al revés de lo que recibe el
 * motor de disponibilidad. Es la diferencia entre restar y explicar: al motor le
 * alcanza con saber que hay un hueco, y acá hay que poder decir de quién es el
 * bloqueo y por qué, que es justamente lo que el reparto borra.
 */
export interface BlockedRange extends SlotRange {
  /** `null` = el bloqueo es del negocio entero. */
  staffId: string | null;
  reason?: string | null;
}

export interface CollectBookingWarningsInput {
  now: Date;
  /** En orden de ejecución. Se asume al menos uno. */
  segments: RequestedSegment[];
  /** Franjas de atención del negocio ese día, ya resueltas a instantes. */
  businessRanges: SlotRange[];
  /** Jornada de cada profesional ese día, por `staffId`. */
  workingRangesByStaff: Record<string, SlotRange[]>;
  /**
   * Lo que cada profesional ya tiene tomado ese día, por `staffId`.
   *
   * No incluye a la reserva que se está editando: sus propios minutos no se
   * pisan consigo misma.
   */
  busyByStaff?: Record<string, SlotRange[]>;
  /** Las franjas marcadas como no disponibles ese día, de cualquier alcance. */
  blocks?: BlockedRange[];
}

/** Dos tramos se pisan si comparten aunque sea un minuto. */
const overlaps = (a: SlotRange, b: SlotRange): boolean =>
  a.startTime < b.endTime && a.endTime > b.startTime;

/**
 * Cómo se cuenta un bloqueo que se pisa con la reserva.
 *
 * El motivo va al final y no reemplaza a la frase: es texto que escribió una
 * persona, puede decir cualquier cosa —o nada—, y la advertencia tiene que
 * seguir siendo legible sin él.
 */
const blockedMessage = (
  block: BlockedRange,
  affected: RequestedSegment,
): string => {
  const who = block.staffId
    ? `${affected.staffName ?? 'El profesional'} tiene ese horario marcado como no disponible`
    : 'Ese horario está marcado como no disponible';

  const reason = block.reason?.trim();

  return reason ? `${who}: ${reason}.` : `${who}.`;
};

/**
 * Las advertencias de una reserva pedida, sin repetir la misma en tres formas.
 *
 * Con el local cerrado, todo lo demás es consecuencia: nadie está de turno y
 * ninguna hora está dentro del horario. Decir las tres cosas no informa más, así
 * que se dice la que explica. Lo mismo entre fuera de horario y fuera de
 * jornada: si el negocio no abre a esa hora, que el profesional no esté de turno
 * no agrega nada.
 */
export const collectBookingWarnings = (
  input: CollectBookingWarningsInput,
): BookingWarning[] => {
  const { now, segments, businessRanges, workingRangesByStaff } = input;
  if (segments.length === 0) return [];

  const warnings: BookingWarning[] = [];

  // El inicio de la reserva, que es el primer tramo.
  const start = segments[0].startTime;
  if (start < now) {
    warnings.push({
      code: BookingWarningCode.PAST_TIME,
      message: 'El horario elegido ya pasó.',
    });
  }

  /*
   * Pisarse con otra cita se avisa siempre, aunque el día esté cerrado o la hora
   * quede fuera de horario.
   *
   * Las demás advertencias hablan del calendario del negocio y se explican entre
   * sí; esta habla de otro cliente que ya tiene ese horario, y no es consecuencia
   * de ninguna. Callarla porque además es fuera de hora sería esconder la única
   * que involucra a una persona esperando.
   */
  const busyReported = new Set<string>();
  for (const segment of segments) {
    if (busyReported.has(segment.staffId)) continue;

    const taken = input.busyByStaff?.[segment.staffId] ?? [];
    if (!taken.some((other) => overlaps(segment, other))) continue;

    busyReported.add(segment.staffId);
    warnings.push({
      code: BookingWarningCode.STAFF_BUSY,
      staffId: segment.staffId,
      message: segment.staffName
        ? `${segment.staffName} ya tiene otra cita en ese horario.`
        : 'El profesional ya tiene otra cita en ese horario.',
    });
  }

  /*
   * Los bloqueos se avisan siempre, por el mismo motivo que pisarse con otra
   * cita: no son consecuencia de la forma del calendario.
   *
   * Un bloqueo es una decisión que alguien tomó sobre ese rato en particular
   * —y que muchas veces trae escrito por qué—, así que callarlo porque además
   * el día está cerrado sería tapar el único aviso que explica algo que no se
   * deduce del horario.
   *
   * Uno por bloqueo y no uno por tramo: una reserva de corte y barba que cae
   * entera adentro del mismo bloqueo es un solo problema.
   */
  for (const block of input.blocks ?? []) {
    const affected = segments.find(
      (segment) =>
        overlaps(segment, block) &&
        (block.staffId === null || block.staffId === segment.staffId),
    );

    if (!affected) continue;

    warnings.push({
      code: BookingWarningCode.TIME_BLOCKED,
      ...(block.staffId ? { staffId: block.staffId } : {}),
      message: blockedMessage(block, affected),
    });
  }

  if (businessRanges.length === 0) {
    warnings.push({
      code: BookingWarningCode.CLOSED_DAY,
      message: 'Ese día el negocio está cerrado.',
    });

    return warnings;
  }

  const outsideHours = segments.some(
    (segment) => !isWithinWorkingRanges(businessRanges, segment),
  );

  if (outsideHours) {
    warnings.push({
      code: BookingWarningCode.OUTSIDE_BUSINESS_HOURS,
      message: 'El horario queda fuera del horario de atención.',
    });

    return warnings;
  }

  // Uno por profesional, no uno por tramo: dos servicios con la misma persona
  // fuera de turno son un solo aviso.
  const reported = new Set<string>();
  for (const segment of segments) {
    if (reported.has(segment.staffId)) continue;

    const own = workingRangesByStaff[segment.staffId];
    if (isWithinWorkingRanges(own, segment)) continue;

    reported.add(segment.staffId);
    warnings.push({
      code: BookingWarningCode.STAFF_OFF_SHIFT,
      staffId: segment.staffId,
      message: segment.staffName
        ? `${segment.staffName} está fuera de su jornada en ese horario.`
        : 'El profesional está fuera de su jornada en ese horario.',
    });
  }

  return warnings;
};
