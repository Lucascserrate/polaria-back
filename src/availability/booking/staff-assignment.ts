import type { SlotRange } from '../utils/availability.types';
import { roundIndexesOf } from './slot-builder';
import { assignDistinctStaff } from './staff-matching';

/** Minutos agendados por profesional en una fecha dada. */
export type WorkloadByStaffId = Record<string, number>;

/**
 * Calcula la carga de trabajo de cada profesional para una fecha.
 *
 * La carga se mide en **minutos agendados**, no en cantidad de reservas: dos
 * cortes rápidos no equivalen a una decoloración.
 */
export function calculateWorkloadByStaffId(
  appointmentsByStaff: Record<string, SlotRange[]>,
): WorkloadByStaffId {
  const workload: WorkloadByStaffId = {};

  for (const [staffId, appointments] of Object.entries(appointmentsByStaff)) {
    workload[staffId] = appointments.reduce(
      (total, appointment) => total + durationInMinutes(appointment),
      0,
    );
  }

  return workload;
}

/**
 * Resuelve qué profesional atiende un horario cuando el cliente eligió
 * "Sin preferencia".
 *
 * Gana el de menor carga de trabajo del día. Ante empate, el desempate es por
 * id ascendente: nunca al azar ni por orden de consulta, para que la misma
 * entrada produzca siempre la misma reserva.
 *
 * Devuelve `null` si no hay candidatos, que es la señal de que el horario dejó
 * de estar disponible.
 */
export function resolveStaffForSlot(params: {
  eligibleStaffIds: string[];
  workloadByStaffId: WorkloadByStaffId;
}): string | null {
  const { eligibleStaffIds, workloadByStaffId } = params;

  if (eligibleStaffIds.length === 0) return null;
  if (eligibleStaffIds.length === 1) return eligibleStaffIds[0];

  return byLeastWork(eligibleStaffIds, workloadByStaffId)[0];
}

/**
 * Reparte todos los tramos de una reserva entre profesionales.
 *
 * Es la versión que hace falta cuando algunos tramos ocurren a la vez. Cada
 * tanda se resuelve por separado —las tandas no se pisan, así que quién atiende
 * la segunda no depende de quién atendió la primera— y **dentro** de cada tanda
 * el reparto no puede repetir a nadie.
 *
 * La preferencia se expresa en el orden en que entran los candidatos: primero el
 * de menor carga del día, después por id. Con una tanda de un solo tramo eso es
 * literalmente `resolveStaffForSlot`; con dos, es lo que hace que la manicure y
 * la pedicure caigan en las dos personas más descansadas que puedan hacerlas, y
 * no en las dos primeras que aparezcan.
 *
 * Devuelve `null` si alguna tanda no se puede cubrir. No debería pasar —el
 * horario no se habría ofrecido—, pero entre la lista y la confirmación puede
 * haber entrado otra reserva, y esa carrera se contesta con "ese horario acaba
 * de ocuparse" y no con una cita que pone a la misma persona en dos lugares.
 */
export function resolveStaffForPlan(params: {
  /** Los tramos del plan, en orden. Sólo se lee su tanda. */
  segments: Array<{ roundIndex?: number }>;
  /** Quiénes pueden atender cada tramo, en el mismo orden. */
  eligibleStaffIdsBySegment: string[][];
  workloadByStaffId: WorkloadByStaffId;
}): string[] | null {
  const { segments, eligibleStaffIdsBySegment, workloadByStaffId } = params;

  const assignment = new Array<string>(segments.length);

  for (const round of roundIndexesOf(segments)) {
    const preferred = round.map((index) =>
      byLeastWork(eligibleStaffIdsBySegment[index] ?? [], workloadByStaffId),
    );

    const resolved = assignDistinctStaff(preferred);
    if (!resolved) return null;

    round.forEach((index, position) => {
      assignment[index] = resolved[position];
    });
  }

  return assignment;
}

/** Los mismos profesionales, del más descansado al más cargado. */
function byLeastWork(
  staffIds: string[],
  workloadByStaffId: WorkloadByStaffId,
): string[] {
  return [...staffIds].sort((a, b) => {
    const workloadDifference =
      (workloadByStaffId[a] ?? 0) - (workloadByStaffId[b] ?? 0);
    if (workloadDifference !== 0) return workloadDifference;
    return a < b ? -1 : 1;
  });
}

function durationInMinutes(range: SlotRange): number {
  const milliseconds = range.endTime.getTime() - range.startTime.getTime();
  return Math.max(0, Math.round(milliseconds / 60_000));
}
