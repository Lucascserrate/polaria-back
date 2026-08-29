import { resolveBusinessStatus } from './business-status';

const TIMEZONE = 'America/La_Paz'; // UTC-4, sin horario de verano.

/** Un instante concreto en la zona del negocio, para no depender del reloj real. */
const at = (isoLocal: string) => new Date(`${isoLocal}-04:00`);

// 2026-08-28 fue un viernes.
const FRIDAY = '2026-08-28T';
const SATURDAY = '2026-08-29T';
const SUNDAY = '2026-08-30T';

const weekdays = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  startTime: '09:00',
  endTime: '20:00',
}));

describe('resolveBusinessStatus', () => {
  it('abierto: informa hasta qué hora', () => {
    const status = resolveBusinessStatus({
      businessHours: weekdays,
      timeZone: TIMEZONE,
      now: at(`${FRIDAY}15:30:00`),
    });

    expect(status).toEqual({ open: true, closesAt: '20:00' });
  });

  it('cerrado más temprano el mismo día: abre hoy', () => {
    const status = resolveBusinessStatus({
      businessHours: weekdays,
      timeZone: TIMEZONE,
      now: at(`${FRIDAY}07:00:00`),
    });

    expect(status).toEqual({
      open: false,
      opensAt: { dayOfWeek: 5, time: '09:00', daysAhead: 0 },
    });
  });

  it('cerrado de noche: salta al próximo día que abre', () => {
    // Viernes 21:00 con el fin de semana cerrado: vuelve el lunes.
    const status = resolveBusinessStatus({
      businessHours: weekdays,
      timeZone: TIMEZONE,
      now: at(`${FRIDAY}21:00:00`),
    });

    expect(status).toEqual({
      open: false,
      opensAt: { dayOfWeek: 1, time: '09:00', daysAhead: 3 },
    });
  });

  it('el límite superior de una franja ya es "cerrado"', () => {
    const status = resolveBusinessStatus({
      businessHours: weekdays,
      timeZone: TIMEZONE,
      now: at(`${FRIDAY}20:00:00`),
    });

    expect(status.open).toBe(false);
  });

  it('une las franjas contiguas de un turno partido', () => {
    // Guardado en dos filas pegadas, no es un cierre al mediodía: a las 12:59 el
    // negocio no cierra a las 13:00, cierra a las 20:00.
    const status = resolveBusinessStatus({
      businessHours: [
        { dayOfWeek: 5, startTime: '09:00', endTime: '13:00' },
        { dayOfWeek: 5, startTime: '13:00', endTime: '20:00' },
      ],
      timeZone: TIMEZONE,
      now: at(`${FRIDAY}12:59:00`),
    });

    expect(status).toEqual({ open: true, closesAt: '20:00' });
  });

  it('respeta el corte de un turno partido de verdad', () => {
    const hours = [
      { dayOfWeek: 5, startTime: '09:00', endTime: '13:00' },
      { dayOfWeek: 5, startTime: '15:00', endTime: '20:00' },
    ];

    expect(
      resolveBusinessStatus({
        businessHours: hours,
        timeZone: TIMEZONE,
        now: at(`${FRIDAY}12:00:00`),
      }),
    ).toEqual({ open: true, closesAt: '13:00' });

    expect(
      resolveBusinessStatus({
        businessHours: hours,
        timeZone: TIMEZONE,
        now: at(`${FRIDAY}14:00:00`),
      }),
    ).toEqual({
      open: false,
      opensAt: { dayOfWeek: 5, time: '15:00', daysAhead: 0 },
    });
  });

  it('acepta el HH:MM:SS con el que MySQL devuelve las columnas time', () => {
    const status = resolveBusinessStatus({
      businessHours: [
        { dayOfWeek: 5, startTime: '09:00:00', endTime: '20:00:00' },
      ],
      timeZone: TIMEZONE,
      now: at(`${FRIDAY}10:00:00`),
    });

    expect(status).toEqual({ open: true, closesAt: '20:00' });
  });

  it('el día se resuelve en la zona del negocio, no en UTC', () => {
    // Sábado 22:00 en La Paz ya es domingo en UTC. Con el domingo cerrado y el
    // sábado abierto, leer el día en UTC daría el lunes.
    const status = resolveBusinessStatus({
      businessHours: [
        { dayOfWeek: 6, startTime: '09:00', endTime: '23:00' },
        { dayOfWeek: 0, startTime: '11:00', endTime: '18:00' },
      ],
      timeZone: TIMEZONE,
      now: at(`${SATURDAY}22:00:00`),
    });

    expect(status).toEqual({ open: true, closesAt: '23:00' });
  });

  it('mira toda la semana hacia adelante desde el último día abierto', () => {
    // Domingo por la noche, con el domingo como único día abierto: vuelve dentro
    // de siete días, que es el borde del barrido.
    const status = resolveBusinessStatus({
      businessHours: [{ dayOfWeek: 0, startTime: '11:00', endTime: '18:00' }],
      timeZone: TIMEZONE,
      now: at(`${SUNDAY}19:00:00`),
    });

    expect(status).toEqual({
      open: false,
      opensAt: { dayOfWeek: 0, time: '11:00', daysAhead: 7 },
    });
  });

  it('sin horario cargado no inventa una apertura', () => {
    const status = resolveBusinessStatus({
      businessHours: [],
      timeZone: TIMEZONE,
      now: at(`${FRIDAY}10:00:00`),
    });

    expect(status).toEqual({ open: false, opensAt: null });
  });

  it('descarta las franjas invertidas en lugar de creerles', () => {
    const status = resolveBusinessStatus({
      businessHours: [{ dayOfWeek: 5, startTime: '20:00', endTime: '09:00' }],
      timeZone: TIMEZONE,
      now: at(`${FRIDAY}21:00:00`),
    });

    expect(status).toEqual({ open: false, opensAt: null });
  });
});
