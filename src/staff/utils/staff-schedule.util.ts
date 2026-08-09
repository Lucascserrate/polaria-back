import { BadRequestException } from '@nestjs/common';

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

export interface StaffScheduleInput {
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
 * Valida la jornada **resultante** de un profesional, no el payload recibido.
 *
 * En un PATCH cualquiera de los dos campos puede venir ausente, así que el
 * llamador debe combinar lo que llega con lo que ya está guardado antes de
 * llamar acá: encender el flag sin mandar franjas y mandar franjas vacías con el
 * flag ya encendido son el mismo estado final, y los dos hay que rechazarlos.
 */
export const assertValidStaffSchedules = (input: {
  usesCustomSchedule: boolean;
  schedules: StaffScheduleInput[];
}): void => {
  const { usesCustomSchedule, schedules } = input;

  // Sin esto el profesional desaparecería de la agenda en silencio: con el flag
  // encendido, la ausencia de franjas significa que no trabaja ningún día.
  if (usesCustomSchedule && schedules.length === 0) {
    throw new BadRequestException(
      'Un profesional con jornada propia necesita al menos una franja horaria.',
    );
  }

  const byDay = new Map<number, StaffScheduleInput[]>();

  for (const schedule of schedules) {
    if (toMinutes(schedule.endTime) <= toMinutes(schedule.startTime)) {
      throw new BadRequestException(
        `La franja del ${dayName(schedule.dayOfWeek)} termina antes de empezar.`,
      );
    }

    const dayRanges = byDay.get(schedule.dayOfWeek) ?? [];
    dayRanges.push(schedule);
    byDay.set(schedule.dayOfWeek, dayRanges);
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
