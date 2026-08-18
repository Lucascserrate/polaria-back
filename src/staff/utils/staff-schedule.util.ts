import { BadRequestException } from '@nestjs/common';
import {
  assertValidWeeklySchedule,
  type WeeklyScheduleRange,
} from '../../schedule/weekly-schedule.util';

export type StaffScheduleInput = WeeklyScheduleRange;

/**
 * Valida la jornada **resultante** de un profesional, no el payload recibido.
 *
 * En un PATCH cualquiera de los dos campos puede venir ausente, así que el
 * llamador debe combinar lo que llega con lo que ya está guardado antes de
 * llamar acá: encender el flag sin mandar franjas y mandar franjas vacías con el
 * flag ya encendido son el mismo estado final, y los dos hay que rechazarlos.
 *
 * La forma de las franjas la valida `assertValidWeeklySchedule`, que es común
 * con el horario del negocio. Acá queda solo lo que es propio del profesional:
 * qué significa quedarse sin franjas.
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

  assertValidWeeklySchedule(schedules);
};
