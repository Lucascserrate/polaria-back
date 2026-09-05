/**
 * Quién puede poner un servicio en la agenda.
 *
 * Hay servicios que un negocio no agenda a ciegas: una ortodoncia, un tratamiento
 * estético, una coloración que necesita prueba de mecha. No es que no los ofrezca
 * —los cotiza y los explica— es que primero tiene que ver a la persona.
 *
 * Es un enum y no un `requiresConsultation` booleano porque el booleano nombra el
 * **motivo** y lo que el sistema hace con esto es un **efecto**: quién puede
 * reservar. Cuando aparezca "requiere seña" o "requiere aprobación" —que son otros
 * motivos con el mismo efecto— van acá sin tener que renombrar una columna.
 *
 * Todo lo de este archivo es puro.
 */

export enum ServiceBookingPolicy {
  /** El cliente lo reserva solo. Es el comportamiento de siempre y el default. */
  CLIENT_BOOKS = 'CLIENT_BOOKS',
  /**
   * El cliente no lo reserva: lo agenda el negocio después de una consulta.
   *
   * El servicio sigue existiendo para todo lo demás —el catálogo, el asistente, la
   * página pública, el panel—, y esa es la diferencia con darlo de baja. Lo único
   * que cambia es que no está entre las opciones que el cliente elige.
   */
  CONSULTATION_FIRST = 'CONSULTATION_FIRST',
}

/**
 * Si el cliente puede elegir este servicio por su cuenta.
 *
 * Recibe `string` porque la columna es `varchar` y porque hay filas escritas antes
 * de que esto existiera: un valor desconocido —o vacío— se trata como reservable,
 * que es lo que esas filas siempre fueron. Un dato que no entendemos no puede
 * dejar de vender.
 */
export const isSelfBookable = (policy?: string | null): boolean =>
  policy !== ServiceBookingPolicy.CONSULTATION_FIRST;

/**
 * Lo que se le dice al cliente cuando pide un servicio que no puede reservar.
 *
 * Vive acá y no en cada canal para que el bot, la página pública y el panel digan
 * lo mismo. Explica **y** ofrece una salida: un "no se puede" sin qué hacer después
 * deja al cliente sin siguiente paso y al negocio sin la consulta.
 */
export const CONSULTATION_FIRST_NOTICE =
  'Este servicio requiere una consulta previa. Escribinos y la coordinamos.';
