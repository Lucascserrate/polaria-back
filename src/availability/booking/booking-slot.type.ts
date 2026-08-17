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
 * Define cada cuánto se **ofrece** un horario, no cuánto dura el servicio.
 *
 * El cálculo legado usa 5 minutos porque generaba candidatos para buscar "el más
 * cercano a lo que pidió el usuario". Un flujo guiado ofrece una lista finita, y
 * ahí un paso fino se paga caro: con 15 minutos, una jornada de 9 a 19 produce 40
 * horarios, que en un componente de 10 filas son cinco páginas. Llegar a las 17:00
 * costaba cuatro toques de "Ver más".
 *
 * Media hora es la granularidad natural de una barbería y deja la jornada en 20
 * horarios. Ofrecer 9:00, 9:15, 9:30 y 9:45 era sobre todo ruido.
 */
export const DEFAULT_SLOT_STEP_MINUTES = 30;

/**
 * Margen mínimo entre "ahora" y el primer horario ofrecible. Evita ofrecer un
 * turno que empieza en dos minutos.
 */
export const MIN_LEAD_TIME_MINUTES = 15;
