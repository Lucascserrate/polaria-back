import { isOverlapping } from '../utils/availability.helpers';
import {
  isWithinWorkingRanges,
  startsWithinWorkingRanges,
} from '../utils/working-hours.resolver';
import type { SlotRange } from '../utils/availability.types';
import type { BookingSlot } from './booking-slot.type';

export type StaffBusyMap = Record<string, SlotRange[]>;

/**
 * Un servicio de la reserva, ya ubicado dentro del bloque.
 *
 * `offsetMinutes` es cuánto después del inicio del bloque arranca este tramo, y
 * es lo que convierte a una lista de servicios en una cadena: el segundo empieza
 * cuando termina el primero. La misma cuenta que hace `planBookingSegments` al
 * escribir la cita, y por eso las dos tienen que salir del mismo orden.
 */
export type BookingSegmentSpec = {
  /**
   * Profesionales habilitados para **este** servicio.
   *
   * Ya viene filtrada por el pedido: si el cliente eligió a alguien para este
   * tramo, acá viene esa persona sola. Vacía no puede llegar —sin candidatos no
   * hay horario que calcular— y el servicio corta antes.
   */
  staffIds: string[];
  offsetMinutes: number;
  durationMinutes: number;
};

export type BuildBookingSlotsInput = {
  /** Slots candidatos generados a partir de la cobertura del equipo. */
  candidateSlots: SlotRange[];
  /**
   * Los servicios de la reserva, en orden de ejecución.
   *
   * Uno solo es el caso de siempre —WhatsApp, el panel— y entonces el único
   * tramo ocupa el bloque entero.
   */
  segments: BookingSegmentSpec[];
  /**
   * Franjas de trabajo de cada profesional en la fecha, según
   * `resolveWorkingRangesByStaff`.
   *
   * Es obligatorio: un profesional ausente del mapa no recibe reservas. Estar
   * habilitado para el servicio no implica estar en el local a esa hora.
   */
  workingRangesByStaff: Record<string, SlotRange[]>;
  /** Citas ya agendadas por profesional, para la fecha en cuestión. */
  appointmentsByStaff: StaffBusyMap;
  /** Ningún slot que empiece antes de este momento se ofrece. */
  minStartTime?: Date;
  /**
   * Acepta además los que empiezan dentro de la jornada y terminan después,
   * marcándolos con `endsAfterHours`.
   *
   * Sólo lo pide el panel. La lista que ve un cliente no puede incluirlos: que
   * el negocio decida quedarse media hora más es suyo; que lo decida un cliente
   * sin que el negocio se entere, no.
   */
  allowEndAfterHours?: boolean;
  /**
   * Exige que **una misma persona** pueda con todos los tramos.
   *
   * Es el modo por defecto de una reserva de varios servicios: quien pide un
   * corte y una barba sin elegir profesional espera que lo atienda alguien, no
   * que lo pasen de silla en silla. Sin esto, "cualquier profesional" ofrecería
   * horarios que sólo existen repartiendo la reserva entre dos personas, que es
   * otra cosa y hay que pedirla a propósito.
   *
   * Con un solo tramo no cambia nada: la lista del tramo y la de quienes pueden
   * con todo son la misma.
   */
  requireSingleStaff?: boolean;
};

/**
 * Convierte slots candidatos en horarios ofrecibles.
 *
 * Deliberadamente **no** aplica ningún criterio cosmético: no recorta a N
 * resultados, no exige separación mínima entre horarios, no prefiere minutos
 * "redondos" ni equilibra mañana y tarde. Devuelve todo lo que está disponible.
 *
 * Cuántos horarios mostrar es decisión del renderizador, que es el único que
 * conoce el límite del componente (10 filas en una lista nativa, 200 en un
 * Dropdown de Flows). Mezclar esa decisión con el cálculo fue justamente lo que
 * volvió inutilizable al cálculo anterior.
 *
 * ---
 *
 * **Con varios servicios, cada tramo se resuelve por separado, y eso no es una
 * simplificación**: los tramos van uno detrás del otro y no se solapan, así que
 * quién puede atender el segundo no depende de quién atendió el primero. Es lo
 * que deja que el corte lo haga Diego y la barba Carlos sin resolver ningún
 * encaje combinado — y también que los dos los haga la misma persona, que es un
 * caso particular y no uno distinto.
 */
export function buildBookingSlots(
  input: BuildBookingSlotsInput,
): BookingSlot[] {
  const {
    candidateSlots,
    segments,
    workingRangesByStaff,
    appointmentsByStaff,
    minStartTime,
    allowEndAfterHours = false,
    requireSingleStaff = false,
  } = input;

  if (segments.length === 0) return [];
  if (segments.some((segment) => segment.staffIds.length === 0)) return [];

  const slots: BookingSlot[] = [];

  for (const candidate of candidateSlots) {
    if (minStartTime && candidate.startTime < minStartTime) continue;

    const windows = segments.map((segment) => ({
      segment,
      window: windowOf(candidate.startTime, segment),
    }));

    const eligibleStaffIdsBySegment = windows.map(({ segment, window }) =>
      orderById(segment.staffIds).filter(
        (staffId) =>
          isWithinWorkingRanges(workingRangesByStaff[staffId], window) &&
          isStaffFree(appointmentsByStaff[staffId], window),
      ),
    );

    if (eligibleStaffIdsBySegment.every((ids) => ids.length > 0)) {
      const eligibleStaffIds = intersect(eligibleStaffIdsBySegment);

      if (!requireSingleStaff || eligibleStaffIds.length > 0) {
        slots.push({
          startTime: candidate.startTime,
          endTime: candidate.endTime,
          eligibleStaffIds,
          eligibleStaffIdsBySegment,
        });
        continue;
      }
    }

    if (!allowEndAfterHours) continue;

    /*
     * Nadie lo cubre entero; se mira quién al menos lo empieza dentro.
     *
     * El orden importa: si alguien puede hacerlo completo, el horario es normal
     * y no lleva marca, aunque a otro del equipo se le pase del turno. Marcarlo
     * igual diría que se pasa del horario un horario que no se pasa para quien
     * lo va a atender.
     */
    const startingStaffIdsBySegment = windows.map(({ segment, window }) =>
      orderById(segment.staffIds).filter(
        (staffId) =>
          startsWithinWorkingRanges(
            workingRangesByStaff[staffId],
            window.startTime,
          ) && isStaffFree(appointmentsByStaff[staffId], window),
      ),
    );

    if (startingStaffIdsBySegment.some((ids) => ids.length === 0)) continue;

    const startingStaffIds = intersect(startingStaffIdsBySegment);
    if (requireSingleStaff && startingStaffIds.length === 0) continue;

    slots.push({
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      eligibleStaffIds: startingStaffIds,
      eligibleStaffIdsBySegment: startingStaffIdsBySegment,
      endsAfterHours: true,
    });
  }

  return slots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}

/** Indica si existe al menos un horario ofrecible. */
export function hasAnyBookingSlot(input: BuildBookingSlotsInput): boolean {
  return buildBookingSlots(input).length > 0;
}

/**
 * Busca un horario exacto por su instante de inicio.
 *
 * Es la operación de revalidación: al confirmar, el horario elegido se vuelve a
 * buscar contra disponibilidad fresca. Compara el instante exacto porque el
 * horario provino de un componente que nosotros mismos generamos.
 */
export function findBookingSlotAt(
  slots: BookingSlot[],
  startTime: Date,
): BookingSlot | null {
  const target = startTime.getTime();
  return slots.find((slot) => slot.startTime.getTime() === target) ?? null;
}

/** Los minutos que ocupa un tramo dentro de un bloque que arranca en `start`. */
export function windowOf(
  start: Date,
  segment: { offsetMinutes: number; durationMinutes: number },
): SlotRange {
  const startTime = new Date(start.getTime() + segment.offsetMinutes * 60_000);

  return {
    startTime,
    endTime: new Date(startTime.getTime() + segment.durationMinutes * 60_000),
  };
}

function isStaffFree(
  appointments: SlotRange[] | undefined,
  candidate: SlotRange,
): boolean {
  if (!appointments || appointments.length === 0) return true;
  return !appointments.some((appointment) =>
    isOverlapping(
      appointment.startTime,
      appointment.endTime,
      candidate.startTime,
      candidate.endTime,
    ),
  );
}

/**
 * Los que están en todas las listas, conservando el orden de la primera.
 *
 * Con un solo tramo devuelve esa lista tal cual, que es lo que hace que el caso
 * de siempre no pase por ninguna rama nueva.
 */
function intersect(lists: string[][]): string[] {
  const [first, ...rest] = lists;
  if (rest.length === 0) return [...first];

  const sets = rest.map((list) => new Set(list));
  return first.filter((id) => sets.every((set) => set.has(id)));
}

/** Orden estable por id, para que la salida no dependa del orden de consulta. */
function orderById(staffIds: string[]): string[] {
  return [...staffIds].sort((a, b) => {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  });
}
