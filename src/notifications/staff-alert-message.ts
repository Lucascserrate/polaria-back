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

/*
 * Acá vivía `formatPreviousTime`, que escribía "se movió de las 15:30 a las 17:00".
 *
 * Se fue con la plantilla parametrizada: las tres plantillas aprobadas dicen "Nueva
 * hora: {{4}}" y no tienen hueco para la anterior. La columna `previousStartTime`
 * sigue guardándose porque es el registro de qué cambió —sirve para soporte— pero el
 * mensaje ya no la nombra.
 */

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
