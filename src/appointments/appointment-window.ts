/**
 * De una fecha del calendario a la ventana de instantes que le corresponde.
 *
 * Es el cálculo que decide qué citas pertenecen a un día, y por eso está acá
 * afuera y no como método privado del servicio: un error de una hora no lanza
 * ninguna excepción, solo hace que la primera cita de la mañana aparezca en el
 * día anterior. Todo lo de este archivo es puro y se puede probar sin base.
 *
 * La fecha se interpreta siempre en la zona del negocio y no en la de quien
 * mira la pantalla: a las 21:00 del lunes en Bolivia ya es martes en Europa, y
 * la agenda que corresponde mostrar es la del local.
 */

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export interface UtcWindow {
  /** Inclusive. */
  startUtc: Date;
  /** Exclusive: es la medianoche del día siguiente. */
  endUtc: Date;
}

/**
 * `2026-08-22` a sus tres números, o `null` si la fecha no existe.
 *
 * `Date.UTC` acomoda en silencio un 31 de febrero al 3 de marzo, así que la
 * única forma de detectar una fecha inexistente es ver si sobrevivió igual.
 */
export const parseCalendarDate = (value: string): CalendarDate | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [year, month, day] = match.slice(1).map(Number);

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
};

/** Minutos que la zona lleva de diferencia con UTC en ese instante. */
export const timeZoneOffsetMinutes = (timezone: string, date: Date): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const tz = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0';
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(tz);
  if (!match) return 0;

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? 0);

  return sign * (hours * 60 + minutes);
};

/**
 * Medianoche de esa fecha en esa zona, expresada en UTC.
 *
 * El desplazamiento se mide sobre el instante estimado y no sobre "ahora":
 * entre hoy y la fecha pedida puede haber un cambio de horario de verano, y con
 * el desplazamiento de hoy la ventana quedaría corrida una hora.
 */
const startOfDayUtc = (timezone: string, date: CalendarDate): Date => {
  const guess = Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0);
  return new Date(
    guess - timeZoneOffsetMinutes(timezone, new Date(guess)) * 60000,
  );
};

/** El día siguiente a esa fecha, sin pasar por `Date` para no arrastrar zona. */
const nextDay = (date: CalendarDate): CalendarDate => {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
};

/**
 * Varios días seguidos, con los dos extremos incluidos.
 *
 * `to` inclusive es lo que espera quien pide una semana: `from=lunes` y
 * `to=domingo` tiene que traer el domingo entero, no terminar en su medianoche.
 */
export const rangeWindow = (
  timezone: string,
  from: CalendarDate,
  to: CalendarDate,
): UtcWindow => ({
  startUtc: startOfDayUtc(timezone, from),
  endUtc: startOfDayUtc(timezone, nextDay(to)),
});

/** Cuántos días cubre el rango, contando los dos extremos. `0` si está invertido. */
export const daysInRange = (from: CalendarDate, to: CalendarDate): number => {
  const start = Date.UTC(from.year, from.month - 1, from.day);
  const end = Date.UTC(to.year, to.month - 1, to.day);
  if (end < start) return 0;

  return Math.round((end - start) / 86_400_000) + 1;
};

/** La fecha que es "hoy" en la zona del negocio, como `YYYY-MM-DD`. */
export const currentCalendarDate = (
  timezone: string,
  now: Date,
): CalendarDate => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
  };
};

/**
 * La medianoche de hoy en la zona del negocio, expresada en UTC.
 *
 * Es la frontera de "el día ya terminó". Se calcula en la zona del local y no en
 * la de quien mira: a las 21:00 del lunes en Bolivia ya es martes en Europa, y
 * las citas del lunes todavía no son de un día cerrado.
 */
export const startOfTodayUtc = (timezone: string, now: Date): Date => {
  const today = currentCalendarDate(timezone, now);
  return rangeWindow(timezone, today, today).startUtc;
};
