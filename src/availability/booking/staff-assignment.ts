import type { SlotRange } from '../utils/availability.types';

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

  return [...eligibleStaffIds].sort((a, b) => {
    const workloadDifference =
      (workloadByStaffId[a] ?? 0) - (workloadByStaffId[b] ?? 0);
    if (workloadDifference !== 0) return workloadDifference;
    return a < b ? -1 : 1;
  })[0];
}

function durationInMinutes(range: SlotRange): number {
  const milliseconds = range.endTime.getTime() - range.startTime.getTime();
  return Math.max(0, Math.round(milliseconds / 60_000));
}
