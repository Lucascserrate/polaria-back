/**
 * Lo que WhatsApp contesta cuando el negocio eligió que se agende por el enlace.
 *
 * Es texto y nada más: qué enlace, a quién y cuándo lo decide quien lo usa. Se
 * escribe acá y no dentro del servicio por lo mismo que el resto de los
 * mensajes del asistente —el saludo, el recordatorio—: lo que lee un cliente
 * tiene que poder revisarse sin leer el código que lo envía.
 *
 * Todo lo de este archivo es puro.
 */

/**
 * El cuerpo del mensaje que acompaña al botón.
 *
 * **Dice qué va a encontrar del otro lado**, y no "hacé clic acá". Quien reserva
 * por WhatsApp está acostumbrado a que todo pase en el chat, así que salir de la
 * aplicación es un paso que hay que justificar: lo que lo justifica es poder
 * elegir varios servicios de una vez, que es justamente lo que el chat no hace.
 *
 * No se nombra el negocio: el mensaje sale de su propio WhatsApp, así que ya se
 * sabe de quién es, y repetirlo suena a mensaje automático de un tercero.
 */
export const BOOKING_LINK_BODY =
  'Sacá tu turno desde acá 👇\n\n' +
  'Vas a poder elegir uno o varios servicios, con quién te atendés y el horario que te quede mejor.';

/** Lo que dice el botón. Hasta 20 caracteres: es el tope de WhatsApp. */
export const BOOKING_LINK_BUTTON = 'Sacar turno';

/**
 * El cuerpo del mensaje que lleva al turno que el cliente ya tiene.
 *
 * Avisa que hace falta iniciar sesión, y eso no es un detalle técnico que se
 * pueda omitir: quien toca esperando ver su turno y se encuentra con un botón
 * de Google abandona ahí. Decirlo antes convierte una sorpresa en un paso.
 */
export const APPOINTMENT_LINK_BODY =
  'Podés ver tu turno, cambiarlo de horario o cancelarlo desde acá 👇\n\n' +
  'Te va a pedir que entres con Google una sola vez, para que nadie más pueda ver tus turnos.';

export const APPOINTMENT_LINK_BUTTON = 'Ver mi turno';
