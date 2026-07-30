/**
 * Fechas y etiquetas del flujo de reserva.
 *
 * Todas las fechas del flujo son strings `YYYY-MM-DD` interpretados en la zona
 * horaria del negocio, nunca `Date`. Un `Date` obliga a elegir un instante, y para
 * "el viernes" no hay instante que elegir: hay un día del calendario local.
 */

/** Fecha de hoy en la zona horaria indicada, como `YYYY-MM-DD`. */
export function todayIsoDateIn(
  timeZone: string,
  now: Date = new Date(),
): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Suma días a una fecha calendaria.
 *
 * Opera sobre el calendario en UTC a propósito: sumarle un día a `2026-10-18` debe
 * dar `2026-10-19` aunque esa noche haya cambio de horario de verano en la zona
 * del negocio.
 */
export function addDaysToIsoDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));

  const shiftedYear = shifted.getUTCFullYear();
  const shiftedMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const shiftedDay = String(shifted.getUTCDate()).padStart(2, '0');

  return `${shiftedYear}-${shiftedMonth}-${shiftedDay}`;
}

/**
 * Etiqueta legible para una fila de lista: "vie 31 jul".
 *
 * No recibe zona horaria: la fecha ya es calendaria. Se formatea en UTC sobre un
 * mediodía sintético para que el día del calendario no se corra por offset.
 */
export function formatDateLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const reference = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
    .format(reference)
    .replace(/\./g, '');
}

/** Etiqueta de horario en la zona del negocio: "15:00". */
export function formatTimeLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
}
