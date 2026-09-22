import type { SlotRange } from '../utils/availability.types';

/**
 * Un horario realmente disponible para una reserva y una fecha.
 *
 * A diferencia de `SuggestedSlot` (el modelo del flujo conversacional, que
 * colapsaba cada horario a un único profesional), un `BookingSlot` conserva
 * **todos** los profesionales habilitados y libres en ese horario. Esa lista es
 * la que permite resolver "Sin preferencia" por menor carga de trabajo en el
 * momento de confirmar, y no antes.
 *
 * Una reserva puede llevar **varios servicios encadenados**, y por eso el
 * horario va con dos listas y no con una. Las dos hacen falta porque son
 * respuestas a preguntas distintas, y el cliente elige cuál le importa. Ver
 * `buildBookingSlots`.
 */
export type BookingSlot = SlotRange & {
  /**
   * Quiénes pueden hacer **toda** la reserva ellos solos, y están libres de
   * punta a punta. Ordenados por id.
   *
   * Con un servicio es la lista de siempre. Con varios es la que necesita el
   * modo por defecto —un profesional para todo—, y puede quedar vacía en un
   * horario que igual se ofrece: si el corte lo hace Diego y la barba Carlos,
   * el bloque existe aunque ninguno de los dos lo cubra entero.
   */
  eligibleStaffIds: string[];
  /**
   * Lo mismo, tramo por tramo y en el orden de los servicios.
   *
   * Es lo que sostiene "elegir profesional por servicio": los tramos van uno
   * detrás del otro y no se pisan, así que la disponibilidad de cada uno se
   * resuelve por separado. Con un servicio tiene un solo elemento, igual a
   * `eligibleStaffIds`.
   */
  eligibleStaffIdsBySegment: string[][];
  /**
   * Empieza dentro del horario de atención pero termina después.
   *
   * Ausente en todo lo que se le ofrece a un cliente: ahí sólo entra lo que
   * termina dentro. Lo produce el panel, para poder ofrecerlo **marcado** en
   * lugar de esconderlo, y que quien agenda sepa lo que está decidiendo.
   */
  endsAfterHours?: boolean;
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
