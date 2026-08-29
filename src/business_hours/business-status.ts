import type { WeeklyScheduleRange } from '../schedule/weekly-schedule.util';

/**
 * Si el negocio está abierto **ahora**, y hasta cuándo o desde cuándo.
 *
 * Es la primera línea de la página pública de reservas: alguien que llega desde
 * un enlace quiere saber, antes que nada, si puede pasar hoy. La agenda ya
 * responde "qué horarios hay"; esto responde algo distinto y más barato, que no
 * necesita mirar ni una cita.
 *
 * Vive acá y no en el cliente porque depende de la zona horaria del negocio: en
 * el navegador de alguien que abre el enlace desde otro país, "hoy" es otro día.
 * Funciones puras, sin base de datos y sin reloj propio —`now` entra por
 * parámetro— para que se pueda probar sin esperar al martes.
 */

export type BusinessStatus =
  | { open: true; closesAt: string }
  | {
      open: false;
      /**
       * Próxima apertura, o `null` si el negocio no abre ningún día de la
       * semana. `null` no es un error: un negocio recién creado todavía no
       * cargó su horario.
       */
      opensAt: {
        /** 0 = domingo, igual que `Date.getDay()`. */
        dayOfWeek: number;
        /** `HH:MM` en la zona del negocio. */
        time: string;
        /** 0 = hoy más tarde, 1 = mañana. Lo que decide cómo se nombra el día. */
        daysAhead: number;
      } | null;
    };

const MINUTES_IN_DAY = 24 * 60;
const DAYS_IN_WEEK = 7;

/** Minutos desde medianoche. Acepta `HH:MM` y el `HH:MM:SS` de MySQL. */
const toMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const toClock = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
};

type DayRange = { start: number; end: number };

/**
 * El instante actual en la zona del negocio, como día de la semana y minutos.
 *
 * El día se deriva de `Date.UTC` sobre las partes ya traducidas a la zona, en
 * lugar de pedirle el `weekday` a `Intl`: así no hay que mapear nombres de días
 * de un locale, que es de donde salen los errores en este cálculo.
 */
function localNow(
  timeZone: string,
  now: Date,
): { dayOfWeek: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  const dayOfWeek = new Date(
    Date.UTC(value('year'), value('month') - 1, value('day')),
  ).getUTCDay();

  return { dayOfWeek, minutes: value('hour') * 60 + value('minute') };
}

/**
 * Agrupa las franjas por día y une las que se tocan.
 *
 * Un turno partido guardado como `09:00-13:00` y `13:00-20:00` son dos filas
 * pegadas, no un cierre al mediodía. Sin unirlas, a las 12:59 la página diría
 * "abierto hasta las 13:00" y a las 13:00 diría "abierto hasta las 20:00", que
 * es un cierre que nunca ocurre.
 *
 * Las franjas que cruzan medianoche quedan afuera: el modelo de
 * `business_hours` no las admite —`assertValidWeeklySchedule` exige fin
 * posterior a inicio— y tratarlas acá sería inventar un caso que la base no
 * puede producir.
 */
function groupByDay(ranges: WeeklyScheduleRange[]): Map<number, DayRange[]> {
  const byDay = new Map<number, DayRange[]>();

  for (const range of ranges) {
    const start = toMinutes(range.startTime);
    const end = toMinutes(range.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }

    const day = byDay.get(range.dayOfWeek) ?? [];
    day.push({ start, end });
    byDay.set(range.dayOfWeek, day);
  }

  for (const [day, list] of byDay) {
    list.sort((a, b) => a.start - b.start);

    const merged: DayRange[] = [];
    for (const range of list) {
      const previous = merged[merged.length - 1];
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
        continue;
      }
      merged.push({ ...range });
    }

    byDay.set(day, merged);
  }

  return byDay;
}

export function resolveBusinessStatus(params: {
  businessHours: WeeklyScheduleRange[];
  timeZone: string;
  now: Date;
}): BusinessStatus {
  const { businessHours, timeZone, now } = params;
  const byDay = groupByDay(businessHours);
  const { dayOfWeek, minutes } = localNow(timeZone, now);

  const today = byDay.get(dayOfWeek) ?? [];
  const current = today.find(
    (range) => range.start <= minutes && minutes < range.end,
  );
  if (current) {
    /*
     * `24:00` no existe como hora del reloj: un cierre a medianoche se anuncia
     * como `00:00`, que es lo que lee cualquiera.
     */
    return { open: true, closesAt: toClock(current.end % MINUTES_IN_DAY) };
  }

  /*
   * Hasta `DAYS_IN_WEEK` **inclusive**: un negocio que abre un solo día de la
   * semana, consultado esa misma noche cuando ya cerró, vuelve dentro de siete
   * días. Con el tope exclusivo esa vuelta caía fuera del barrido y el negocio
   * se anunciaba como si no abriera nunca.
   */
  for (let daysAhead = 0; daysAhead <= DAYS_IN_WEEK; daysAhead += 1) {
    const day = (dayOfWeek + daysAhead) % DAYS_IN_WEEK;
    const next = (byDay.get(day) ?? []).find(
      (range) => daysAhead > 0 || range.start > minutes,
    );

    if (next) {
      return {
        open: false,
        opensAt: { dayOfWeek: day, time: toClock(next.start), daysAhead },
      };
    }
  }

  return { open: false, opensAt: null };
}
