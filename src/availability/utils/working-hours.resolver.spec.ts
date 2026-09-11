import { makeDateInTimeZone } from './availability.helpers';
import type { SlotRange } from './availability.types';
import {
  datesWithCoverage,
  isWithinWorkingRanges,
  mergeRanges,
  resolveWorkingRanges,
  resolveWorkingRangesByStaff,
  subtractRanges,
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

/** Un tramo absoluto del lunes de prueba: una franja ya resuelta, un bloqueo. */
const slot = (startTime: string, endTime: string): SlotRange => ({
  startTime: at(startTime),
  endTime: at(endTime),
});

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
  blocks?: SlotRange[];
}) =>
  resolveWorkingRanges({
    date: MONDAY,
    timeZone: TIME_ZONE,
    businessHours: input.businessHours,
    usesCustomSchedule: input.usesCustomSchedule ?? false,
    staffSchedules: input.staffSchedules ?? [],
    blocks: input.blocks,
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

  /*
   * La capa de excepciones por fecha. Es una resta y no una intersección: lo que
   * define a un bloqueo es que puede caer en el medio de la jornada y partirla.
   */
  it('parte la jornada en dos cuando el bloqueo cae en el medio', () => {
    const ranges = resolve({
      businessHours: [weekly('09:00', '18:00')],
      blocks: [slot('12:00', '13:00')],
    });

    expect(asLocalTimes(ranges)).toEqual(
      expected(['09:00', '12:00'], ['13:00', '18:00']),
    );
  });

  it('recorta el borde cuando el bloqueo arranca con la jornada', () => {
    const ranges = resolve({
      businessHours: [weekly('09:00', '18:00')],
      blocks: [slot('09:00', '11:00')],
    });

    expect(asLocalTimes(ranges)).toEqual(expected(['11:00', '18:00']));
  });

  it('deja la jornada vacía cuando el bloqueo la cubre entera', () => {
    const ranges = resolve({
      businessHours: [weekly('09:00', '18:00')],
      blocks: [slot('08:00', '20:00')],
    });

    expect(ranges).toEqual([]);
  });

  it('resta después de recortar contra el negocio, no antes', () => {
    // El bloqueo se come una hora que la jornada propia ya no tenía: no puede
    // devolverla ni correr el borde.
    const ranges = resolve({
      businessHours: [weekly('09:00', '18:00')],
      usesCustomSchedule: true,
      staffSchedules: [weekly('10:00', '16:00')],
      blocks: [slot('08:00', '10:30')],
    });

    expect(asLocalTimes(ranges)).toEqual(expected(['10:30', '16:00']));
  });

  it('atraviesa un turno partido restando de los dos tramos', () => {
    const ranges = resolve({
      businessHours: [weekly('09:00', '13:00'), weekly('15:00', '20:00')],
      blocks: [slot('12:00', '16:00')],
    });

    expect(asLocalTimes(ranges)).toEqual(
      expected(['09:00', '12:00'], ['16:00', '20:00']),
    );
  });

  it('ignora un bloqueo de otro día', () => {
    const ranges = resolve({
      businessHours: [weekly('09:00', '18:00')],
      // Mismas horas, pero del martes: no toca la jornada del lunes.
      blocks: [
        {
          startTime: makeDateInTimeZone('2026-03-17', '12:00', TIME_ZONE),
          endTime: makeDateInTimeZone('2026-03-17', '13:00', TIME_ZONE),
        },
      ],
    });

    expect(asLocalTimes(ranges)).toEqual(expected(['09:00', '18:00']));
  });

  it('sin bloqueos devuelve la jornada intacta', () => {
    const ranges = resolve({
      businessHours: [weekly('09:00', '18:00')],
      blocks: [],
    });

    expect(asLocalTimes(ranges)).toEqual(expected(['09:00', '18:00']));
  });
});

describe('resolveWorkingRangesByStaff', () => {
  const byStaff = (blocksByStaff?: Record<string, SlotRange[]>) =>
    resolveWorkingRangesByStaff({
      date: MONDAY,
      timeZone: TIME_ZONE,
      businessHours: [weekly('09:00', '18:00')],
      staff: [
        { id: 'lucas', usesCustomSchedule: false },
        { id: 'fernando', usesCustomSchedule: false },
      ],
      schedulesByStaff: {},
      blocksByStaff,
    });

  /* Lo que hace que "se fue Lucas" no sea "cerró el local". */
  it('el bloqueo de uno no le toca la jornada al otro', () => {
    const ranges = byStaff({ lucas: [slot('12:00', '13:00')] });

    expect(asLocalTimes(ranges.lucas)).toEqual(
      expected(['09:00', '12:00'], ['13:00', '18:00']),
    );
    expect(asLocalTimes(ranges.fernando)).toEqual(expected(['09:00', '18:00']));
  });

  it('sin bloqueos, todos conservan su jornada', () => {
    const ranges = byStaff();

    expect(asLocalTimes(ranges.lucas)).toEqual(expected(['09:00', '18:00']));
    expect(asLocalTimes(ranges.fernando)).toEqual(expected(['09:00', '18:00']));
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

describe('subtractRanges', () => {
  const workday = [slot('09:00', '18:00')];

  it('sin huecos devuelve lo mismo', () => {
    expect(asLocalTimes(subtractRanges(workday, []))).toEqual(
      expected(['09:00', '18:00']),
    );
  });

  it('parte la franja cuando el hueco cae adentro', () => {
    expect(
      asLocalTimes(subtractRanges(workday, [slot('12:00', '13:00')])),
    ).toEqual(expected(['09:00', '12:00'], ['13:00', '18:00']));
  });

  it('recorta por el principio', () => {
    expect(
      asLocalTimes(subtractRanges(workday, [slot('07:00', '10:00')])),
    ).toEqual(expected(['10:00', '18:00']));
  });

  it('recorta por el final', () => {
    expect(
      asLocalTimes(subtractRanges(workday, [slot('17:00', '22:00')])),
    ).toEqual(expected(['09:00', '17:00']));
  });

  it('elimina la franja que queda tapada entera', () => {
    expect(subtractRanges(workday, [slot('09:00', '18:00')])).toEqual([]);
  });

  it('deja intacta la franja cuando el hueco no la toca', () => {
    expect(
      asLocalTimes(subtractRanges(workday, [slot('19:00', '21:00')])),
    ).toEqual(expected(['09:00', '18:00']));
  });

  /* Un hueco que termina justo donde empieza la franja no le saca nada. */
  it('no recorta por tocarse en el borde', () => {
    expect(
      asLocalTimes(subtractRanges(workday, [slot('07:00', '09:00')])),
    ).toEqual(expected(['09:00', '18:00']));
  });

  it('aplica varios huecos a la misma franja', () => {
    expect(
      asLocalTimes(
        subtractRanges(workday, [
          slot('11:00', '12:00'),
          slot('15:00', '16:00'),
        ]),
      ),
    ).toEqual(
      expected(['09:00', '11:00'], ['12:00', '15:00'], ['16:00', '18:00']),
    );
  });

  it('acepta los huecos desordenados', () => {
    expect(
      asLocalTimes(
        subtractRanges(workday, [
          slot('15:00', '16:00'),
          slot('11:00', '12:00'),
        ]),
      ),
    ).toEqual(
      expected(['09:00', '11:00'], ['12:00', '15:00'], ['16:00', '18:00']),
    );
  });

  /*
   * Dos bloqueos que se pisan son dos motivos para el mismo rato, no un dato
   * roto. Sin fusionarlos antes, el segundo cortaría un pedazo que el primero ya
   * se había llevado y saldría una franja de cero minutos.
   */
  it('fusiona los huecos que se solapan antes de restar', () => {
    expect(
      asLocalTimes(
        subtractRanges(workday, [
          slot('11:00', '14:00'),
          slot('13:00', '15:00'),
        ]),
      ),
    ).toEqual(expected(['09:00', '11:00'], ['15:00', '18:00']));
  });

  it('resta de varias franjas a la vez', () => {
    const split = [slot('09:00', '13:00'), slot('15:00', '20:00')];

    expect(
      asLocalTimes(subtractRanges(split, [slot('10:00', '16:00')])),
    ).toEqual(expected(['09:00', '10:00'], ['16:00', '20:00']));
  });

  it('no muta las franjas recibidas', () => {
    const original = slot('09:00', '18:00');
    subtractRanges([original], [slot('12:00', '13:00')]);

    expect(original.endTime.toISOString()).toBe(at('18:00').toISOString());
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

  /*
   * Un feriado: el local abre según el horario, pero ese día está bloqueado
   * entero. Es el mismo caso que el domingo —no se puede llegar a él— y tiene
   * que desaparecer del selector de fechas, no ofrecerse para después contestar
   * "no quedan horarios".
   */
  it('descarta el día bloqueado entero para todo el equipo', () => {
    const wednesday = (time: string) =>
      makeDateInTimeZone('2026-03-18', time, TIME_ZONE);

    expect(
      datesWithCoverage({
        dates: WEEK,
        timeZone: TIME_ZONE,
        businessHours: OPEN_MONDAY_TO_SATURDAY,
        staff: withoutOwnSchedule,
        schedulesByStaff: {},
        blocksByStaff: {
          fernando: [
            { startTime: wednesday('08:00'), endTime: wednesday('20:00') },
          ],
        },
      }),
    ).toEqual([
      '2026-03-16',
      '2026-03-17',
      '2026-03-19',
      '2026-03-20',
      '2026-03-21',
    ]);
  });

  it('conserva el día al que el bloqueo solo le saca un rato', () => {
    const wednesday = (time: string) =>
      makeDateInTimeZone('2026-03-18', time, TIME_ZONE);

    expect(
      datesWithCoverage({
        dates: ['2026-03-18'],
        timeZone: TIME_ZONE,
        businessHours: OPEN_MONDAY_TO_SATURDAY,
        staff: withoutOwnSchedule,
        schedulesByStaff: {},
        blocksByStaff: {
          fernando: [
            { startTime: wednesday('12:00'), endTime: wednesday('13:00') },
          ],
        },
      }),
    ).toEqual(['2026-03-18']);
  });

  it('conserva el día en que al otro no lo bloquearon', () => {
    const wednesday = (time: string) =>
      makeDateInTimeZone('2026-03-18', time, TIME_ZONE);

    expect(
      datesWithCoverage({
        dates: ['2026-03-18'],
        timeZone: TIME_ZONE,
        businessHours: OPEN_MONDAY_TO_SATURDAY,
        staff: [
          { id: 'lucas', usesCustomSchedule: false },
          { id: 'fernando', usesCustomSchedule: false },
        ],
        schedulesByStaff: {},
        blocksByStaff: {
          lucas: [
            { startTime: wednesday('08:00'), endTime: wednesday('20:00') },
          ],
        },
      }),
    ).toEqual(['2026-03-18']);
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

  describe('notBefore', () => {
    it('descarta el día cuya jornada ya terminó', () => {
      // Lunes 20:00, con el local cerrado desde las 19:00. Ofrecer "hoy" lleva a
      // un paso de horarios vacío: el día existe, pero ya no se llega.
      expect(
        datesWithCoverage({
          dates: ['2026-03-16', '2026-03-17'],
          timeZone: TIME_ZONE,
          businessHours: OPEN_MONDAY_TO_SATURDAY,
          staff: withoutOwnSchedule,
          schedulesByStaff: {},
          notBefore: new Date('2026-03-16T20:00:00-04:00'),
        }),
      ).toEqual(['2026-03-17']);
    });

    it('conserva el día al que todavía le queda jornada', () => {
      expect(
        datesWithCoverage({
          dates: ['2026-03-16'],
          timeZone: TIME_ZONE,
          businessHours: OPEN_MONDAY_TO_SATURDAY,
          staff: withoutOwnSchedule,
          schedulesByStaff: {},
          notBefore: new Date('2026-03-16T18:59:00-04:00'),
        }),
      ).toEqual(['2026-03-16']);
    });

    it('omitirlo deja el comportamiento anterior', () => {
      // Las consultas que no tienen un "ahora" —o que miran el pasado a
      // propósito— siguen viendo todas las fechas con jornada.
      expect(
        datesWithCoverage({
          dates: ['2026-03-16'],
          timeZone: TIME_ZONE,
          businessHours: OPEN_MONDAY_TO_SATURDAY,
          staff: withoutOwnSchedule,
          schedulesByStaff: {},
        }),
      ).toEqual(['2026-03-16']);
    });
  });
});
