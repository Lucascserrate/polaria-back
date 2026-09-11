import type { SlotRange } from './availability.types';

/** Una fila de `schedule_blocks`, reducida a lo que el cálculo necesita. */
export interface StaffBlockRow {
  /** `null` = el bloqueo es del negocio entero. */
  staffId: string | null;
  startTime: Date;
  endTime: Date;
}

/**
 * Reparte los bloqueos entre los profesionales a los que les tapan horas.
 *
 * Es la única regla que tiene esta tabla, y por eso vive acá y no en el
 * resolvedor: para el cálculo de horarios un bloqueo es un hueco y nada más
 * —restarlo es todo lo que hay que saber hacer con él—, mientras que saber que
 * un hueco sin dueño es de todos es saber cómo se guarda.
 *
 * Un bloqueo del negocio entero se repite en la lista de cada uno en lugar de
 * viajar por un carril aparte. Duplicar la referencia sale gratis —son objetos
 * que nadie muta— y evita que cada consumidor tenga que acordarse de mirar dos
 * listas; el que se olvidara ofrecería horarios de un local cerrado.
 *
 * Todos los profesionales pedidos salen con una entrada, aunque sea vacía: es lo
 * que `resolveWorkingRangesByStaff` espera, igual que con las jornadas.
 */
export const groupBlocksByStaff = (
  blocks: StaffBlockRow[],
  staffIds: string[],
): Record<string, SlotRange[]> => {
  const uniqueStaffIds = Array.from(new Set(staffIds)).filter(Boolean);

  const grouped: Record<string, SlotRange[]> = {};
  for (const id of uniqueStaffIds) grouped[id] = [];

  for (const block of blocks) {
    const range: SlotRange = {
      startTime: block.startTime,
      endTime: block.endTime,
    };

    if (block.staffId === null) {
      for (const id of uniqueStaffIds) grouped[id].push(range);
      continue;
    }

    // Un bloqueo de alguien que no vino en la lista no tiene dónde ir. Pasa al
    // filtrar por servicio: el profesional existe, pero no hace ese servicio.
    grouped[block.staffId]?.push(range);
  }

  return grouped;
};
