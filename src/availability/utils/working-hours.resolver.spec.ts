import { makeDateInTimeZone } from './availability.helpers';
import type { SlotRange } from './availability.types';
import {
  datesWithCoverage,
  isWithinWorkingRanges,
  mergeRanges,
  resolveWorkingRanges,
  type WeeklyTimeRange,
} from './working-hours.resolver';

const TIME_ZONE = 'America/La_Paz'; // UTC-4 todo el año
const MONDAY = '2026-03-16';
const MONDAY_DOW = 1;
const TUESDAY_DOW = 2;

/** Instante absoluto de una hora local del lunes de prueba. */
const at = (time: string): Date => makeDateInTimeZone(MONDAY, time, TIME_ZONE);

const weekly = (
  startTime: string,
  endTime: string,
  dayOfWeek = MONDAY_DOW,
): WeeklyTimeRange => ({ dayOfWeek, startTime, endTime });

const asLocalTimes = (ranges: SlotRange[]): string[][] =>
  ranges.map((range) => [
    range.startTime.toISOString(),
    range.endTime.toISOString(),
  ]);

const expected = (...pairs: [string, string][]): string[][] =>
  pairs.map(([start, end]) => [at(start).toISOString(), at(end).toISOString()]);

const resolve = (input: {
  businessHours: WeeklyTimeRange[];
  usesCustomSchedule?: boolean;
  staffSchedules?: WeeklyTimeRange[];
}) =>
  resolveWorkingRanges({
    date: MONDAY,
    timeZone: TIME_ZONE,
    businessHours: input.businessHours,
    usesCustomSchedule: input.usesCustomSchedule ?? false,
    staffSchedules: input.staffSchedules ?? [],
  });

describe('resolveWorkingRanges', () => {
  it('hereda el horario del negocio cuando el flag está apagado', () => {
    const ranges = resolve({
      businessHours: [weekly('09:00', '20:00')],
      usesCustomSchedule: false,
      // Se ignoran por completo: el flag apagado manda.
      staffSchedules: [weekly('13:00', '21:00')],
    });

    expect(asLocalTimes(ranges)).toEqual(expected(['09:00', '20:00']));
  });

  it('resuelve los instantes en la zona horaria del negocio', () => {
    const ranges = resolve({ businessHours: [weekly('09:00', '20:00')] });

    expect(ranges[0].startTime.toISOString()).toBe('2026-03-16T13:00:00.000Z');
    expect(ranges[0].endTime.toISOString()).toBe('2026-03-17T00:00:00.000Z');
  });

  it('no devuelve nada si el negocio está cerrado ese día', () => {
    const ranges = resolve({
      businessHours: [weekly('09:00', '20:00', TUESDAY_DOW)],
      usesCustomSchedule: true,
      staffSchedules: [weekly('09:00', '20:00')],
    });

    expect(ranges).toEqual([]);
  });

  it('no devuelve nada si el profesional no tiene jornada cargada ese día', () => {
    const ranges = resolve({
      businessHours: [weekly('09:00', '20:00')],
      usesCustomSchedule: true,
      staffSchedules: [weekly('09:00', '17:00', TUESDAY_DOW)],
    });

    expect(ranges).toEqual([]);
  });

  it('recorta la jornada propia contra el horario del negocio', () => {
    const ranges = resolve({
      businessHours: [weekly('09:00', '20:00')],
      usesCustomSchedule: true,
      staffSchedules: [weekly('13:00', '21:00')],
    });

    expect(asLocalTimes(ranges)).toEqual(expected(['13:00', '20:00']));
  });

  it('nunca excede el horario del negocio, ni siquiera con una jornada más amplia', () => {
    const ranges = resolve({
      businessHours: [weekly('09:00', '20:00')],
      usesCustomSchedule: true,
      staffSchedules: [weekly('06:00', '23:00')],
    });

    expect(asLocalTimes(ranges)).toEqual(expected(['09:00', '20:00']));
  });

  it('respeta el turno partido del negocio', () => {
    const ranges = resolve({
      businessHours: [weekly('09:00', '13:00'), weekly('15:00', '20:00')],
      usesCustomSchedule: true,
      staffSchedules: [weekly('11:00', '17:00')],
    });

    expect(asLocalTimes(ranges)).toEqual(
      expected(['11:00', '13:00'], ['15:00', '17:00']),
    );
  });

  it('respeta el turno partido del profesional', () => {
    const ranges = resolve({
      businessHours: [weekly('09:00', '20:00')],
      usesCustomSchedule: true,
      staffSchedules: [weekly('09:00', '12:00'), weekly('16:00', '20:00')],
    });

    expect(asLocalTimes(ranges)).toEqual(
      expected(['09:00', '12:00'], ['16:00', '20:00']),
    );
  });

  it('no devuelve nada cuando la jornada no se solapa con el negocio', () => {
    const ranges = resolve({
      businessHours: [weekly('09:00', '13:00')],
      usesCustomSchedule: true,
      staffSchedules: [weekly('15:00', '20:00')],
    });

    expect(ranges).toEqual([]);
  });

  it('fusiona franjas contiguas del negocio en un solo tramo', () => {
    const ranges = resolve({
      businessHours: [weekly('09:00', '13:00'), weekly('13:00', '20:00')],
    });

    expect(asLocalTimes(ranges)).toEqual(expected(['09:00', '20:00']));
  });

  it('acepta el formato HH:MM:SS con el que MySQL devuelve las columnas time', () => {
    const ranges = resolve({
      businessHours: [weekly('09:00:00', '20:00:00')],
      usesCustomSchedule: true,
      staffSchedules: [weekly('13:00:00', '21:00:00')],
    });

    expect(asLocalTimes(ranges)).toEqual(expected(['13:00', '20:00']));
  });

  it('descarta franjas con fin anterior o igual al inicio', () => {
    const ranges = resolve({
      businessHours: [weekly('20:00', '09:00'), weekly('10:00', '10:00')],
    });

    expect(ranges).toEqual([]);
  });

  it('ignora las franjas de otros días de la semana', () => {
    const ranges = resolve({
      businessHours: [
        weekly('06:00', '08:00', TUESDAY_DOW),
        weekly('09:00', '20:00'),
      ],
    });

    expect(asLocalTimes(ranges)).toEqual(expected(['09:00', '20:00']));
  });
});

describe('mergeRanges', () => {
  const range = (start: string, end: string): SlotRange => ({
    startTime: at(start),
    endTime: at(end),
  });

  it('fusiona franjas solapadas', () => {
    const merged = mergeRanges([
      range('09:00', '17:00'),
      range('13:00', '21:00'),
    ]);

    expect(asLocalTimes(merged)).toEqual(expected(['09:00', '21:00']));
  });

  it('fusiona franjas contiguas', () => {
    const merged = mergeRanges([
      range('09:00', '13:00'),
      range('13:00', '20:00'),
    ]);

    expect(asLocalTimes(merged)).toEqual(expected(['09:00', '20:00']));
  });

  it('conserva separadas las franjas disjuntas y las ordena', () => {
    const merged = mergeRanges([
      range('15:00', '20:00'),
      range('09:00', '13:00'),
    ]);

    expect(asLocalTimes(merged)).toEqual(
      expected(['09:00', '13:00'], ['15:00', '20:00']),
    );
  });

  it('absorbe una franja contenida dentro de otra', () => {
    const merged = mergeRanges([
      range('09:00', '20:00'),
      range('11:00', '13:00'),
    ]);

    expect(asLocalTimes(merged)).toEqual(expected(['09:00', '20:00']));
  });

  it('no muta las franjas recibidas', () => {
    const original = range('09:00', '13:00');
    mergeRanges([original, range('13:00', '20:00')]);

    expect(original.endTime.toISOString()).toBe(at('13:00').toISOString());
  });
});

describe('isWithinWorkingRanges', () => {
  const ranges: SlotRange[] = [
    { startTime: at('09:00'), endTime: at('13:00') },
    { startTime: at('15:00'), endTime: at('20:00') },
  ];
  const candidate = (start: string, end: string): SlotRange => ({
    startTime: at(start),
    endTime: at(end),
  });

  it('acepta un slot contenido en una franja', () => {
    expect(isWithinWorkingRanges(ranges, candidate('10:00', '10:30'))).toBe(
      true,
    );
  });

  it('acepta un slot que coincide exactamente con la franja', () => {
    expect(isWithinWorkingRanges(ranges, candidate('15:00', '20:00'))).toBe(
      true,
    );
  });

  it('rechaza un slot que empieza antes de la franja', () => {
    expect(isWithinWorkingRanges(ranges, candidate('08:30', '09:30'))).toBe(
      false,
    );
  });

  it('rechaza un slot que termina después de la franja', () => {
    expect(isWithinWorkingRanges(ranges, candidate('19:30', '20:30'))).toBe(
      false,
    );
  });

  it('rechaza un slot que cruza el hueco entre dos franjas', () => {
    expect(isWithinWorkingRanges(ranges, candidate('12:30', '15:30'))).toBe(
      false,
    );
  });

  it('rechaza cualquier slot cuando no hay franjas', () => {
    expect(isWithinWorkingRanges([], candidate('10:00', '10:30'))).toBe(false);
    expect(isWithinWorkingRanges(undefined, candidate('10:00', '10:30'))).toBe(
      false,
    );
  });
});

describe('datesWithCoverage', () => {
  /*
   * Semana de prueba: lunes 16 a domingo 22 de marzo de 2026. El negocio abre de
   * lunes a sábado, así que el domingo no debería ofrecerse nunca.
   */
  const WEEK = [
    '2026-03-16',
    '2026-03-17',
    '2026-03-18',
    '2026-03-19',
    '2026-03-20',
    '2026-03-21',
    '2026-03-22',
  ];

  const OPEN_MONDAY_TO_SATURDAY: WeeklyTimeRange[] = [1, 2, 3, 4, 5, 6].map(
    (dayOfWeek) => weekly('09:00', '19:00', dayOfWeek),
  );

  const withoutOwnSchedule = [{ id: 'fernando', usesCustomSchedule: false }];

  it('descarta el día en que el negocio está cerrado', () => {
    // Es el caso que se veía en WhatsApp: elegir "domingo 22" y recibir "no
    // quedan horarios" para un día en que el local ni abre.
    expect(
      datesWithCoverage({
        dates: WEEK,
        timeZone: TIME_ZONE,
        businessHours: OPEN_MONDAY_TO_SATURDAY,
        staff: withoutOwnSchedule,
        schedulesByStaff: {},
      }),
    ).toEqual(WEEK.slice(0, 6));
  });

  it('descarta el día en que nadie del equipo trabaja', () => {
    // El local abre, pero el único profesional no atiende los sábados.
    expect(
      datesWithCoverage({
        dates: WEEK,
        timeZone: TIME_ZONE,
        businessHours: OPEN_MONDAY_TO_SATURDAY,
        staff: [{ id: 'lucas', usesCustomSchedule: true }],
        schedulesByStaff: {
          lucas: [1, 2, 3, 4, 5].map((dayOfWeek) =>
            weekly('09:00', '18:00', dayOfWeek),
          ),
        },
      }),
    ).toEqual(WEEK.slice(0, 5));
  });

  it('conserva el día en que trabaja al menos uno', () => {
    // Lucas no trabaja el sábado pero Fernando sí: el sábado sigue siendo una
    // opción real.
    expect(
      datesWithCoverage({
        dates: ['2026-03-21'],
        timeZone: TIME_ZONE,
        businessHours: OPEN_MONDAY_TO_SATURDAY,
        staff: [
          { id: 'lucas', usesCustomSchedule: true },
          { id: 'fernando', usesCustomSchedule: false },
        ],
        schedulesByStaff: { lucas: [] },
      }),
    ).toEqual(['2026-03-21']);
  });

  it('sin horario del negocio no queda ninguna fecha', () => {
    expect(
      datesWithCoverage({
        dates: WEEK,
        timeZone: TIME_ZONE,
        businessHours: [],
        staff: withoutOwnSchedule,
        schedulesByStaff: {},
      }),
    ).toEqual([]);
  });

  it('sin equipo no queda ninguna fecha', () => {
    expect(
      datesWithCoverage({
        dates: WEEK,
        timeZone: TIME_ZONE,
        businessHours: OPEN_MONDAY_TO_SATURDAY,
        staff: [],
        schedulesByStaff: {},
      }),
    ).toEqual([]);
  });
});
