import { BadRequestException } from '@nestjs/common';
import {
  assertValidStaffSchedules,
  type StaffScheduleInput,
} from './staff-schedule.util';

const MONDAY = 1;
const TUESDAY = 2;

const franja = (
  startTime: string,
  endTime: string,
  dayOfWeek = MONDAY,
): StaffScheduleInput => ({ dayOfWeek, startTime, endTime });

const assertSchedules =
  (schedules: StaffScheduleInput[], usesCustomSchedule = true) =>
  () =>
    assertValidStaffSchedules({ usesCustomSchedule, schedules });

describe('assertValidStaffSchedules', () => {
  it('acepta una jornada simple', () => {
    expect(assertSchedules([franja('09:00', '17:00')])).not.toThrow();
  });

  it('acepta un turno partido', () => {
    expect(
      assertSchedules([franja('09:00', '13:00'), franja('15:00', '20:00')]),
    ).not.toThrow();
  });

  it('acepta franjas contiguas, que el resolvedor fusiona', () => {
    expect(
      assertSchedules([franja('09:00', '13:00'), franja('13:00', '20:00')]),
    ).not.toThrow();
  });

  it('acepta el mismo horario en días distintos', () => {
    expect(
      assertSchedules([
        franja('09:00', '17:00', MONDAY),
        franja('09:00', '17:00', TUESDAY),
      ]),
    ).not.toThrow();
  });

  it('rechaza la jornada propia sin ninguna franja', () => {
    expect(assertSchedules([], true)).toThrow(BadRequestException);
    expect(assertSchedules([], true)).toThrow(/al menos una franja/);
  });

  it('permite no tener franjas cuando hereda el horario del negocio', () => {
    expect(assertSchedules([], false)).not.toThrow();
  });

  it('permite guardar franjas aunque el flag esté apagado', () => {
    // Conserva la jornada cargada para cuando el negocio vuelva a encender el
    // flag, sin que la disponibilidad la lea mientras tanto.
    expect(assertSchedules([franja('09:00', '17:00')], false)).not.toThrow();
  });

  it('rechaza una franja que termina antes de empezar', () => {
    expect(assertSchedules([franja('20:00', '09:00')])).toThrow(
      /termina antes de empezar/,
    );
  });

  it('rechaza una franja de duración cero', () => {
    expect(assertSchedules([franja('10:00', '10:00')])).toThrow(
      BadRequestException,
    );
  });

  it('rechaza franjas superpuestas del mismo día', () => {
    expect(
      assertSchedules([franja('09:00', '14:00'), franja('13:00', '20:00')]),
    ).toThrow(/se superponen/);
  });

  it('detecta la superposición aunque lleguen desordenadas', () => {
    expect(
      assertSchedules([franja('13:00', '20:00'), franja('09:00', '14:00')]),
    ).toThrow(/se superponen/);
  });

  it('detecta una franja contenida dentro de otra', () => {
    expect(
      assertSchedules([franja('09:00', '20:00'), franja('11:00', '13:00')]),
    ).toThrow(/se superponen/);
  });

  it('no confunde franjas superpuestas de días distintos', () => {
    expect(
      assertSchedules([
        franja('09:00', '14:00', MONDAY),
        franja('13:00', '20:00', TUESDAY),
      ]),
    ).not.toThrow();
  });

  it('nombra el día en el mensaje de error', () => {
    expect(
      assertSchedules([
        franja('09:00', '14:00', TUESDAY),
        franja('13:00', '20:00', TUESDAY),
      ]),
    ).toThrow(/martes/);
  });

  it('compara bien el HH:MM:SS que devuelve MySQL contra el HH:MM del cliente', () => {
    // Al validar un PATCH parcial se mezclan las franjas ya guardadas con las
    // que llegan en el body.
    expect(
      assertSchedules([
        franja('09:00:00', '13:00:00'),
        franja('12:30', '20:00'),
      ]),
    ).toThrow(/se superponen/);

    expect(
      assertSchedules([
        franja('09:00:00', '13:00:00'),
        franja('13:00', '20:00'),
      ]),
    ).not.toThrow();
  });
});
