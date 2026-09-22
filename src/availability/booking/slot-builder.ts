import { isOverlapping } from '../utils/availability.helpers';
import {
  isWithinWorkingRanges,
  startsWithinWorkingRanges,
} from '../utils/working-hours.resolver';
import type { SlotRange } from '../utils/availability.types';
import type { BookingSlot } from './booking-slot.type';

export type StaffBusyMap = Record<string, SlotRange[]>;

export type BuildBookingSlotsInput = {
  /** Slots candidatos generados a partir de la cobertura del equipo. */
  candidateSlots: SlotRange[];
  /** Profesionales habilitados para el servicio elegido. */
  staffIds: string[];
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
 */
export function buildBookingSlots(
  input: BuildBookingSlotsInput,
): BookingSlot[] {
  const {
    candidateSlots,
    staffIds,
    workingRangesByStaff,
    appointmentsByStaff,
    minStartTime,
    allowEndAfterHours = false,
  } = input;

  if (staffIds.length === 0) return [];

  const orderedStaffIds = [...staffIds].sort(compareStaffIds);

  const slots: BookingSlot[] = [];

  for (const candidate of candidateSlots) {
    if (minStartTime && candidate.startTime < minStartTime) continue;

    const free = (staffId: string) =>
      isStaffFree(appointmentsByStaff[staffId], candidate);

    const eligibleStaffIds = orderedStaffIds.filter(
      (staffId) =>
        isWithinWorkingRanges(workingRangesByStaff[staffId], candidate) &&
        free(staffId),
    );

    if (eligibleStaffIds.length > 0) {
      slots.push({
        startTime: candidate.startTime,
        endTime: candidate.endTime,
        eligibleStaffIds,
      });
      continue;
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
    const startingStaffIds = orderedStaffIds.filter(
      (staffId) =>
        startsWithinWorkingRanges(
          workingRangesByStaff[staffId],
          candidate.startTime,
        ) && free(staffId),
    );

    if (startingStaffIds.length === 0) continue;

    slots.push({
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      eligibleStaffIds: startingStaffIds,
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

/** Orden estable por id, para que la salida no dependa del orden de consulta. */
function compareStaffIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
