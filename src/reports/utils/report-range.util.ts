import { BadRequestException } from '@nestjs/common';
import {
  currentDateInTimeZone,
  makeDateInTimeZone,
} from '../../availability/utils/availability.helpers';

export const REPORT_PRESETS = ['today', 'week', 'month', 'custom'] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface ReportRange {
  /** Primer día del período (YYYY-MM-DD) en la zona horaria del negocio. */
  from: string;
  /** Último día del período, inclusive. */
  to: string;
  /** Instante inicial del período. */
  startUtc: Date;
  /**
   * Instante final **exclusivo**: medianoche del día siguiente a `to`. Se usa
   * `< endUtc` en vez de `BETWEEN` para no depender de la precisión de los
   * `timestamp` ni dejar afuera una cita a las 23:59:59.
   */
  endUtc: Date;
}

/**
 * Corre una fecha de calendario N días.
 *
 * La aritmética es en UTC puro y sobre la fecha sola, sin hora: así un cambio de
 * horario de verano no puede empujar el resultado al día anterior o siguiente.
 */
const shiftDays = (isoDate: string, days: number): string => {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
};

/** Día de la semana con la semana arrancando en lunes (0 = lunes). */
const weekdayFromMonday = (isoDate: string): number => {
  const [year, month, day] = isoDate.split('-').map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
};

const lastDayOfMonth = (isoDate: string): string => {
  const [year, month] = isoDate.split('-').map(Number);
  // Día 0 del mes siguiente es el último del actual.
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};

/** Cuántos días de calendario cubre el rango, contando los dos extremos. */
const dayCount = (from: string, to: string): number => {
  const at = (isoDate: string) => {
    const [year, month, day] = isoDate.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((at(to) - at(from)) / 86_400_000) + 1;
};

const resolveDays = (
  preset: ReportPreset,
  today: string,
  from?: string,
  to?: string,
): [string, string] => {
  switch (preset) {
    case 'today':
      return [today, today];

    case 'week': {
      const monday = shiftDays(today, -weekdayFromMonday(today));
      return [monday, shiftDays(monday, 6)];
    }

    case 'month':
      return [`${today.slice(0, 7)}-01`, lastDayOfMonth(today)];

    case 'custom': {
      if (!from || !to) {
        throw new BadRequestException(
          'El rango personalizado requiere "from" y "to"',
        );
      }
      if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
        throw new BadRequestException(
          'Las fechas deben tener formato YYYY-MM-DD',
        );
      }
      // Comparación lexicográfica: válida para fechas ISO de ancho fijo.
      if (from > to) {
        throw new BadRequestException('"from" no puede ser posterior a "to"');
      }
      return [from, to];
    }
  }
};

/** Un rango de fechas del negocio llevado a instantes. */
const buildRange = (
  from: string,
  to: string,
  timeZone: string,
): ReportRange => ({
  from,
  to,
  startUtc: makeDateInTimeZone(from, '00:00', timeZone),
  endUtc: makeDateInTimeZone(shiftDays(to, 1), '00:00', timeZone),
});

/**
 * Traduce el filtro que eligió el dueño a un intervalo de instantes.
 *
 * Los presets se resuelven contra el calendario del negocio, no el del servidor:
 * "hoy" para una barbería en La Paz termina a las 04:00 UTC del día siguiente.
 * `week` y `month` cubren el período completo (lunes a domingo, día 1 a fin de
 * mes) y no solo hasta hoy, para que el conteo de citas pendientes muestre lo
 * que todavía queda por atender.
 */
export const resolveReportRange = (
  query: { preset?: ReportPreset; from?: string; to?: string },
  timeZone: string,
  now: Date,
): ReportRange => {
  const today = currentDateInTimeZone(timeZone, now);
  const [from, to] = resolveDays(
    query.preset ?? 'today',
    today,
    query.from,
    query.to,
  );

  return buildRange(from, to, timeZone);
};

/**
 * El período inmediatamente anterior al que se está mirando, para comparar.
 *
 * La regla general es "la misma cantidad de días, pegados justo antes": para
 * `today` da ayer, para `week` da el lunes a domingo anterior, y para un rango a
 * medida de nueve días da los nueve días previos.
 *
 * `month` es la excepción y tiene que serlo: corriendo 31 días hacia atrás desde
 * el 1 de marzo se cae en el 29 de enero, y nadie compara marzo contra "casi
 * febrero". Un mes se compara con el mes de calendario anterior aunque midan
 * distinto, porque eso es lo que la gente quiere decir con "el mes pasado".
 *
 * Se deriva del rango ya resuelto y no de `now`: así el período anterior de un
 * rango personalizado no depende de qué día se lo consulte.
 */
export const previousReportRange = (
  range: ReportRange,
  preset: ReportPreset,
  timeZone: string,
): ReportRange => {
  if (preset === 'month') {
    // El día previo al primero del mes es el último del mes anterior.
    const lastDay = shiftDays(`${range.from.slice(0, 7)}-01`, -1);
    return buildRange(`${lastDay.slice(0, 7)}-01`, lastDay, timeZone);
  }

  const length = dayCount(range.from, range.to);
  return buildRange(
    shiftDays(range.from, -length),
    shiftDays(range.from, -1),
    timeZone,
  );
};
