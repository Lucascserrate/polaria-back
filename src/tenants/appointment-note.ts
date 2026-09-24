/**
 * La nota que el negocio le muestra al cliente junto a su turno.
 *
 * Nació de un pedido concreto: una barbería que cobra el 50% por adelantado y
 * cancela la reserva si no recibe el comprobante. Eso no es un servicio, ni un
 * horario, ni una dirección —no tiene dónde vivir en el modelo— y sin embargo es
 * lo único que decide si el cliente aparece. Antes se lo decían por WhatsApp de
 * a uno, o no se lo decían.
 *
 * **Es del negocio y no del turno**: es la misma indicación para todos, y
 * escribirla una vez es justamente lo que la hace sostenible. Una nota por cita
 * sería otra cosa —un mensaje— y tendría que escribirse una por una.
 *
 * `NULL` es el estado normal y significa que no hay nada que decir: la sección
 * no se dibuja. Es distinto del saludo de WhatsApp, donde `NULL` quiere decir
 * "el de fábrica" porque ahí siempre tiene que salir algo.
 *
 * Todo lo de este archivo es puro.
 */

/**
 * Hasta dónde puede escribir el negocio.
 *
 * Mil caracteres es más de lo que nadie va a usar —el caso real que lo motivó
 * son unos trescientos— y menos de lo que convierte la pantalla del turno en un
 * reglamento. El límite viaja al panel desde el backend para que no haya dos
 * números que se puedan desincronizar.
 */
export const APPOINTMENT_NOTE_MAX_LENGTH = 1000;

/**
 * La nota lista para guardar, o `null`.
 *
 * Se recorta y el vacío se guarda como `null`, que es lo que hace que borrar el
 * contenido del campo en el panel apague la sección en lugar de dejar un título
 * con un espacio debajo. Existe como función y no escrita en el servicio porque
 * son dos caminos —los ajustes y el alta— y dos criterios darían una nota que se
 * ve en una pantalla y no en la otra.
 */
export const normalizeAppointmentNote = (
  value: string | null | undefined,
): string | null => value?.trim() || null;
