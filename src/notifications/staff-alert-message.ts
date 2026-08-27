/**
 * Cómo se escriben la fecha y la hora de un aviso a un profesional.
 *
 * Separado del envío y puro, igual que `reminder-message`: la zona horaria importa
 * **acá y solo acá**. El instante es absoluto, y lo que el profesional tiene que
 * leer es la hora del local.
 */

/** `jueves 21 de agosto` en la zona horaria del negocio. */
export function formatAlertDate(startTime: Date, timezone: string): string {
  return new Intl.DateTimeFormat('es', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(startTime);
}

/** `16:00` en la zona horaria del negocio, en 24 horas. */
export function formatAlertTime(startTime: Date, timezone: string): string {
  return new Intl.DateTimeFormat('es', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(startTime);
}

/**
 * La hora anterior, solo si decirla aporta algo.
 *
 * Devuelve `null` cuando la hora del reloj no cambió —se movió de día, no de
 * hora—, porque "se movió de las 16:00 a las 16:00" es peor que no decir nada.
 */
export function formatPreviousTime(params: {
  previousStartTime: Date | null;
  startTime: Date;
  timezone: string;
}): string | null {
  if (!params.previousStartTime) return null;

  const previous = formatAlertTime(params.previousStartTime, params.timezone);
  const current = formatAlertTime(params.startTime, params.timezone);

  return previous === current ? null : previous;
}

/**
 * `YYYY-MM-DD` en la zona del negocio, para el enlace del botón.
 *
 * La misma forma que lee `/mi-agenda?date=`, y la misma que usa la agenda del
 * panel. Se calcula en la zona del local y no en UTC por el motivo de siempre: una
 * cita de las 22:00 en Bolivia es de ese día, aunque en UTC ya sea el siguiente.
 */
export function formatAlertDateKey(startTime: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(startTime);

  // `en-CA` ya devuelve `YYYY-MM-DD`, que es justamente por lo que se usa acá.
  return parts;
}
