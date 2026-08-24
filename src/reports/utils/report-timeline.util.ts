import { currentCalendarDate } from '../../appointments/appointment-window';

/**
 * Cómo evolucionó la facturación dentro del período.
 *
 * Es lo único que el reporte no podía responder: devolvía totales, así que "cómo
 * viene el mes" obligaba a pedirlo día por día. Un total dice cuánto; esto dice
 * si viene subiendo, si hubo un pico o si el lunes está muerto.
 *
 * Todo acá es puro. La agrupación por día se hace **en memoria y no en SQL** a
 * propósito: el día es el del negocio, no el de UTC, y agrupar por fecha UTC
 * mandaría las citas de la tarde-noche al día siguiente. `CONVERT_TZ` de MySQL
 * exige las tablas de zonas cargadas y un desplazamiento fijo se rompe con el
 * horario de verano, así que la cuenta se hace acá, donde `Intl` sabe la verdad.
 */

export type TimelineGranularity = 'day' | 'month';

export interface TimelineBucket {
  /** `YYYY-MM-DD` por día, `YYYY-MM` por mes. */
  key: string;
  revenue: number;
  /** Citas distintas atendidas en el tramo, no servicios prestados. */
  completed: number;
}

export interface ReportTimeline {
  granularity: TimelineGranularity;
  buckets: TimelineBucket[];
}

/** Un servicio facturado, con a qué cita pertenece. */
export interface TimelineEntry {
  appointmentId: string;
  startTime: Date;
  price: number;
}

/**
 * Hasta acá se agrupa por día; más largo pasa a meses.
 *
 * Dos meses son ~62 barras, que todavía se leen. Un año en barras diarias son
 * 365 columnas de dos píxeles: deja de ser un gráfico y pasa a ser ruido.
 */
const MAX_DAILY_BUCKETS = 62;

const pad = (value: number) => String(value).padStart(2, '0');

/** `YYYY-MM-DD` de una fecha calendaria. */
const dayKey = (year: number, month: number, day: number) =>
  `${year}-${pad(month)}-${pad(day)}`;

const parseKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day };
};

/** Los días del rango, ambos extremos incluidos. */
const daysBetween = (from: string, to: string): string[] => {
  const start = parseKey(from);
  const end = parseKey(to);

  const days: string[] = [];
  let cursor = Date.UTC(start.year, start.month - 1, start.day);
  const last = Date.UTC(end.year, end.month - 1, end.day);

  while (cursor <= last) {
    const date = new Date(cursor);
    days.push(
      dayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()),
    );
    cursor += 86_400_000;
  }

  return days;
};

/**
 * La evolución del período, o `null` si no hay ninguna que mostrar.
 *
 * Un rango de un solo día devuelve `null`: una sola barra no compara nada, y el
 * resumen ya dice ese número.
 *
 * Los tramos vacíos se incluyen. Un día sin facturar es información —el martes
 * no vino nadie— y saltearlo dejaría un gráfico que miente sobre el ritmo.
 */
export const buildReportTimeline = (input: {
  /** Extremos del rango, en la zona del negocio. */
  from: string;
  to: string;
  timezone: string;
  entries: TimelineEntry[];
}): ReportTimeline | null => {
  const days = daysBetween(input.from, input.to);
  if (days.length <= 1) return null;

  const granularity: TimelineGranularity =
    days.length <= MAX_DAILY_BUCKETS ? 'day' : 'month';

  const keyOf = (key: string) =>
    granularity === 'day' ? key : key.slice(0, 7);

  // Los tramos se arman primero, en orden, para que los vacíos existan.
  const buckets = new Map<
    string,
    { revenue: number; appointments: Set<string> }
  >();
  for (const day of days) {
    const key = keyOf(day);
    if (!buckets.has(key)) {
      buckets.set(key, { revenue: 0, appointments: new Set() });
    }
  }

  for (const entry of input.entries) {
    const date = currentCalendarDate(input.timezone, entry.startTime);
    const key = keyOf(dayKey(date.year, date.month, date.day));

    const bucket = buckets.get(key);
    // Un servicio fuera del rango no debería llegar acá; si llega, se ignora en
    // lugar de inventarle un tramo que el eje no tiene.
    if (!bucket) continue;

    bucket.revenue += entry.price;
    bucket.appointments.add(entry.appointmentId);
  }

  return {
    granularity,
    buckets: [...buckets.entries()].map(([key, value]) => ({
      key,
      // Dos decimales: es plata, y sumar flotantes deja colas de centésimas.
      revenue: Math.round(value.revenue * 100) / 100,
      completed: value.appointments.size,
    })),
  };
};
