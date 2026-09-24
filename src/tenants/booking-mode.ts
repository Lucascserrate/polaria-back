/**
 * Cómo agenda un cliente que escribe por WhatsApp.
 *
 * Nació de un pedido concreto: una manicurista cuyas clientas reservan tres o
 * cuatro servicios por visita, y el flujo guiado de WhatsApp toma **uno por
 * conversación**. Para ella la reserva por chat es un trámite que hay que
 * repetir, y prefiere mandarlas a su página, donde entran hasta cinco servicios
 * en una sola reserva.
 *
 * **No es el arreglo del problema de fondo y conviene no confundirlo.** Que
 * WhatsApp tome un servicio por vez es una limitación del flujo, no del canal:
 * el motor de abajo ya razona en listas de servicios y la página pública ya las
 * manda. Esto le da al negocio la decisión mientras tanto, y hay negocios que
 * van a preferir el enlace aunque el chat aprenda a tomar varios.
 *
 * Todo lo de este archivo es puro.
 */

export enum BookingMode {
  /**
   * El flujo guiado dentro del chat: servicio, profesional, horario, confirmar.
   *
   * Es el de fábrica y el que va a seguir usando la mayoría. Reserva sin salir
   * de WhatsApp, que para mucha gente es la única aplicación que tiene abierta.
   */
  GUIDED_CHAT = 'GUIDED_CHAT',

  /**
   * WhatsApp saluda y contesta, pero agendar manda a la página del negocio.
   *
   * El asistente sigue siendo el mismo en todo lo demás: reconoce a quien ya
   * tiene turno, responde preguntas y deriva a una persona. Lo único que cambia
   * es a dónde lleva "Agendar cita".
   */
  BOOKING_LINK = 'BOOKING_LINK',
}

export const DEFAULT_BOOKING_MODE = BookingMode.GUIDED_CHAT;

export const BOOKING_MODES = Object.values(BookingMode);

export const isBookingMode = (value: unknown): value is BookingMode =>
  typeof value === 'string' && BOOKING_MODES.includes(value as BookingMode);

/**
 * El modo del negocio, con el de fábrica para lo que no se pueda leer.
 *
 * Un valor desconocido en la columna —una fila vieja, un despliegue a medias—
 * cae al flujo guiado y no rompe la conversación. Es la única de las dos
 * opciones que funciona sin ninguna otra condición: el enlace necesita que el
 * negocio tenga página.
 */
export const bookingModeOf = (tenant: {
  bookingMode?: string | null;
  slug?: string | null;
}): BookingMode => {
  if (!isBookingMode(tenant.bookingMode)) return DEFAULT_BOOKING_MODE;

  /*
   * Sin slug no hay enlace, y un "Agendar cita" que no lleva a ningún lado es
   * peor que el flujo guiado. Los ajustes impiden llegar a este estado; esto es
   * la red por si se llega igual —un slug que se borra a mano, una fila
   * importada—, y hace que la conversación siga funcionando en lugar de quedar
   * muda en el paso más importante.
   */
  if (tenant.bookingMode === BookingMode.BOOKING_LINK && !tenant.slug) {
    return DEFAULT_BOOKING_MODE;
  }

  return tenant.bookingMode;
};
