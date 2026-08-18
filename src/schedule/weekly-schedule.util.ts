import { BadRequestException } from '@nestjs/common';

/**
 * Reglas de una jornada semanal, compartidas por las dos que existen en el
 * sistema: el horario del negocio (`business_hours`) y la jornada propia de un
 * profesional (`staff_schedules`).
 *
 * Las dos tablas guardan la misma estructura —una fila por franja, con día,
 * inicio y fin— y por eso comparten validación: una franja invertida o dos
 * franjas superpuestas son un dato roto en cualquiera de las dos.
 *
 * Vive fuera de `availability`, que es donde está `WeeklyTimeRange`, porque
 * `availability` importa las entidades de `business_hours` y de `staff`. Poner
 * acá lo que esos módulos necesitan importar de vuelta evita el ciclo.
 *
 * No es un módulo de Nest: no hay nada que inyectar, solo funciones puras.
 */

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const DAY_NAMES = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
];

export interface WeeklyScheduleRange {
  /** 0 = domingo, igual que `Date.getDay()`. */
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

/**
 * Minutos desde medianoche. Compara bien tanto el `HH:MM` que manda el cliente
 * como el `HH:MM:SS` con el que MySQL devuelve las columnas `time`, que es lo
 * que llega cuando se valida contra las franjas ya guardadas.
 */
const toMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const dayName = (dayOfWeek: number): string =>
  DAY_NAMES[dayOfWeek] ?? `día ${dayOfWeek}`;

/**
 * Valida una jornada semanal completa.
 *
 * Permite varias franjas por día —el turno partido del mediodía— y por eso el
 * chequeo de solapamiento es por día y no global.
 *
 * No exige que haya franjas: "sin jornada" significa cosas distintas en cada
 * tabla y esa decisión queda en el llamador.
 */
export const assertValidWeeklySchedule = (
  ranges: WeeklyScheduleRange[],
): void => {
  const byDay = new Map<number, WeeklyScheduleRange[]>();

  for (const range of ranges) {
    if (toMinutes(range.endTime) <= toMinutes(range.startTime)) {
      throw new BadRequestException(
        `La franja del ${dayName(range.dayOfWeek)} termina antes de empezar.`,
      );
    }

    const dayRanges = byDay.get(range.dayOfWeek) ?? [];
    dayRanges.push(range);
    byDay.set(range.dayOfWeek, dayRanges);
  }

  for (const [dayOfWeek, dayRanges] of byDay) {
    const sorted = [...dayRanges].sort(
      (a, b) => toMinutes(a.startTime) - toMinutes(b.startTime),
    );

    for (let index = 1; index < sorted.length; index += 1) {
      // Contiguas sí (09:00–13:00 y 13:00–20:00): el resolvedor las fusiona en
      // un tramo. Solapadas no: es entrada mal cargada y se arreglaría sola sin
      // que el negocio se entere.
      if (
        toMinutes(sorted[index].startTime) <
        toMinutes(sorted[index - 1].endTime)
      ) {
        throw new BadRequestException(
          `Las franjas del ${dayName(dayOfWeek)} se superponen entre sí.`,
        );
      }
    }
  }
};
