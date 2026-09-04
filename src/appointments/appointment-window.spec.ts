import {
  currentCalendarDate,
  daysInRange,
  parseCalendarDate,
  rangeWindow,
  startOfTodayUtc,
  timeZoneOffsetMinutes,
} from './appointment-window';

/** Bolivia: UTC-4 todo el año. Es la zona por defecto de los negocios. */
const LA_PAZ = 'America/La_Paz';
/** Santiago sí cambia de hora: sirve para ver que el desplazamiento no se fija. */
const SANTIAGO = 'America/Santiago';

describe('parseCalendarDate', () => {
  it('acepta una fecha del calendario', () => {
    expect(parseCalendarDate('2026-08-22')).toEqual({
      year: 2026,
      month: 8,
      day: 22,
    });
  });

  it('rechaza lo que no tenga el formato exacto', () => {
    expect(parseCalendarDate('2026-8-22')).toBeNull();
    expect(parseCalendarDate('22/08/2026')).toBeNull();
    expect(parseCalendarDate('')).toBeNull();
  });

  it('rechaza una fecha que no existe', () => {
    // `Date.UTC` la acomodaría al 3 de marzo sin avisar.
    expect(parseCalendarDate('2026-02-31')).toBeNull();
    expect(parseCalendarDate('2026-13-01')).toBeNull();
  });

  it('acepta el 29 de febrero de un año bisiesto', () => {
    expect(parseCalendarDate('2028-02-29')).not.toBeNull();
    expect(parseCalendarDate('2027-02-29')).toBeNull();
  });
});

describe('rangeWindow de un solo día', () => {
  const oneDay = (year: number, month: number, day: number) =>
    rangeWindow(LA_PAZ, { year, month, day }, { year, month, day });

  it('abre a la medianoche del negocio y cierra en la del día siguiente', () => {
    const { startUtc, endUtc } = oneDay(2026, 8, 22);

    // Medianoche en UTC-4 es 04:00 UTC.
    expect(startUtc.toISOString()).toBe('2026-08-22T04:00:00.000Z');
    expect(endUtc.toISOString()).toBe('2026-08-23T04:00:00.000Z');
  });

  it('cruza el fin de mes sin saltearse el día', () => {
    const { startUtc, endUtc } = oneDay(2026, 8, 31);

    expect(startUtc.toISOString()).toBe('2026-08-31T04:00:00.000Z');
    expect(endUtc.toISOString()).toBe('2026-09-01T04:00:00.000Z');
  });

  it('usa el desplazamiento de la fecha pedida, no el de hoy', () => {
    // Enero es verano en Santiago (UTC-3) y julio invierno (UTC-4). Con un
    // desplazamiento fijo, una de las dos ventanas quedaría corrida una hora.
    const summer = rangeWindow(
      SANTIAGO,
      { year: 2026, month: 1, day: 15 },
      { year: 2026, month: 1, day: 15 },
    );
    const winter = rangeWindow(
      SANTIAGO,
      { year: 2026, month: 7, day: 15 },
      { year: 2026, month: 7, day: 15 },
    );

    expect(summer.startUtc.toISOString()).toBe('2026-01-15T03:00:00.000Z');
    expect(winter.startUtc.toISOString()).toBe('2026-07-15T04:00:00.000Z');
  });
});

describe('rangeWindow', () => {
  it('incluye el último día completo', () => {
    // De lunes a domingo: el domingo tiene que entrar entero.
    const { startUtc, endUtc } = rangeWindow(
      LA_PAZ,
      { year: 2026, month: 8, day: 17 },
      { year: 2026, month: 8, day: 23 },
    );

    expect(startUtc.toISOString()).toBe('2026-08-17T04:00:00.000Z');
    expect(endUtc.toISOString()).toBe('2026-08-24T04:00:00.000Z');
  });

  it('cruza el cambio de año', () => {
    const { startUtc, endUtc } = rangeWindow(
      LA_PAZ,
      { year: 2026, month: 12, day: 28 },
      { year: 2027, month: 1, day: 3 },
    );

    expect(startUtc.toISOString()).toBe('2026-12-28T04:00:00.000Z');
    expect(endUtc.toISOString()).toBe('2027-01-04T04:00:00.000Z');
  });
});

describe('daysInRange', () => {
  it('cuenta los dos extremos', () => {
    const monday = { year: 2026, month: 8, day: 17 };
    const sunday = { year: 2026, month: 8, day: 23 };

    expect(daysInRange(monday, sunday)).toBe(7);
    expect(daysInRange(monday, monday)).toBe(1);
  });

  it('devuelve 0 cuando el rango está invertido', () => {
    expect(
      daysInRange(
        { year: 2026, month: 8, day: 23 },
        { year: 2026, month: 8, day: 17 },
      ),
    ).toBe(0);
  });
});

describe('currentCalendarDate', () => {
  it('devuelve el día del negocio y no el de UTC', () => {
    // 02:00 UTC del 23 es todavía el 22 a las 22:00 en Bolivia.
    const instant = new Date('2026-08-23T02:00:00.000Z');

    expect(currentCalendarDate(LA_PAZ, instant)).toEqual({
      year: 2026,
      month: 8,
      day: 22,
    });
  });
});

describe('timeZoneOffsetMinutes', () => {
  it('lee el desplazamiento de la zona', () => {
    const instant = new Date('2026-08-22T12:00:00.000Z');

    expect(timeZoneOffsetMinutes(LA_PAZ, instant)).toBe(-240);
    expect(timeZoneOffsetMinutes('UTC', instant)).toBe(0);
  });

  it('soporta zonas con media hora de diferencia', () => {
    const instant = new Date('2026-08-22T12:00:00.000Z');

    expect(timeZoneOffsetMinutes('Asia/Kolkata', instant)).toBe(330);
  });
});

describe('startOfTodayUtc', () => {
  /*
   * Es la frontera de "el día ya terminó", y de ella depende qué citas se le
   * reclaman al negocio como sin cerrar. Una hora de error mete las de esta
   * mañana en la lista de días pasados.
   */
  it('es la medianoche del local, no la de UTC', () => {
    const instant = new Date('2026-08-22T15:00:00.000Z');

    expect(startOfTodayUtc(LA_PAZ, instant).toISOString()).toBe(
      '2026-08-22T04:00:00.000Z',
    );
  });

  /*
   * El caso que separa las dos zonas: a las 02:00 UTC del sábado en Bolivia
   * todavía es viernes por la noche, así que las citas del viernes **no** son de
   * un día cerrado y no corresponde reclamarlas.
   */
  it('respeta que el día del local puede ser el anterior', () => {
    const instant = new Date('2026-08-22T02:00:00.000Z');

    expect(startOfTodayUtc(LA_PAZ, instant).toISOString()).toBe(
      '2026-08-21T04:00:00.000Z',
    );
    expect(startOfTodayUtc('UTC', instant).toISOString()).toBe(
      '2026-08-22T00:00:00.000Z',
    );
  });

  /* En una zona con horario de verano, el desplazamiento es el del día pedido. */
  it('toma el desplazamiento vigente ese día', () => {
    const summer = startOfTodayUtc(
      SANTIAGO,
      new Date('2026-01-15T18:00:00.000Z'),
    );
    const winter = startOfTodayUtc(
      SANTIAGO,
      new Date('2026-07-15T18:00:00.000Z'),
    );

    expect(summer.toISOString()).toBe('2026-01-15T03:00:00.000Z');
    expect(winter.toISOString()).toBe('2026-07-15T04:00:00.000Z');
  });
});
