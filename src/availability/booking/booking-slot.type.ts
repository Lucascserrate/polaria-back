import type { SlotRange } from '../utils/availability.types';

/**
 * Un horario realmente disponible para un servicio y una fecha.
 *
 * A diferencia de `SuggestedSlot` (el modelo del flujo conversacional, que
 * colapsaba cada horario a un único profesional), un `BookingSlot` conserva
 * **todos** los profesionales habilitados y libres en ese horario. Esa lista es
 * la que permite resolver "Sin preferencia" por menor carga de trabajo en el
 * momento de confirmar, y no antes.
 */
export type BookingSlot = SlotRange & {
  /** Profesionales que pueden hacer el servicio y están libres. Ordenados por id. */
  eligibleStaffIds: string[];
};

/**
 * Paso entre horarios ofrecidos, en minutos.
 *
 * El cálculo legado usa 5 minutos porque generaba candidatos para buscar "el más
 * cercano a lo que pidió el usuario". Un flujo guiado en cambio ofrece una lista
 * finita, así que conviene un paso más grueso: produce horarios legibles y menos
 * candidatos que descartar.
 */
export const DEFAULT_SLOT_STEP_MINUTES = 15;

/**
 * Margen mínimo entre "ahora" y el primer horario ofrecible. Evita ofrecer un
 * turno que empieza en dos minutos.
 */
export const MIN_LEAD_TIME_MINUTES = 15;
