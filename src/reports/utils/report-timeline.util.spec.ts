import {
  buildReportTimeline,
  type TimelineEntry,
} from './report-timeline.util';

const LA_PAZ = 'America/La_Paz'; // UTC-4 todo el año

/** Un servicio facturado a una hora local del día indicado. */
const entry = (
  day: string,
  localTime: string,
  price: number,
  appointmentId = `appt-${day}-${localTime}`,
): TimelineEntry => {
  const [year, month, date] = day.split('-').map(Number);
  const [hours, minutes] = localTime.split(':').map(Number);

  return {
    appointmentId,
    // La Paz está cuatro horas detrás de UTC.
    startTime: new Date(Date.UTC(year, month - 1, date, hours + 4, minutes)),
    price,
  };
};

const build = (input: {
  from: string;
  to: string;
  entries?: TimelineEntry[];
}) =>
  buildReportTimeline({
    from: input.from,
    to: input.to,
    timezone: LA_PAZ,
    entries: input.entries ?? [],
  });

describe('buildReportTimeline', () => {
  it('un solo día no tiene evolución que mostrar', () => {
    // Una sola barra no compara nada, y el resumen ya dice ese número.
    expect(
      build({
        from: '2026-08-24',
        to: '2026-08-24',
        entries: [entry('2026-08-24', '10:00', 100)],
      }),
    ).toBeNull();
  });

  it('agrupa por día y respeta el orden del rango', () => {
    const timeline = build({
      from: '2026-08-24',
      to: '2026-08-26',
      entries: [
        entry('2026-08-26', '10:00', 50),
        entry('2026-08-24', '10:00', 100),
      ],
    });

    expect(timeline?.granularity).toBe('day');
    expect(timeline?.buckets.map((b) => b.key)).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
    ]);
    expect(timeline?.buckets.map((b) => b.revenue)).toEqual([100, 0, 50]);
  });

  it('incluye los días vacíos', () => {
    // Un martes sin facturar es información: saltearlo mentiría sobre el ritmo.
    const timeline = build({ from: '2026-08-24', to: '2026-08-27' });

    expect(timeline?.buckets).toHaveLength(4);
    expect(timeline?.buckets.every((b) => b.revenue === 0)).toBe(true);
  });

  it('cuenta citas distintas, no servicios prestados', () => {
    // Una cita de corte y barba son dos tramos facturados y una sola atendida.
    const timeline = build({
      from: '2026-08-24',
      to: '2026-08-25',
      entries: [
        entry('2026-08-24', '10:00', 50, 'appt-1'),
        entry('2026-08-24', '10:30', 40, 'appt-1'),
        entry('2026-08-24', '11:00', 50, 'appt-2'),
      ],
    });

    expect(timeline?.buckets[0]).toEqual({
      key: '2026-08-24',
      revenue: 140,
      completed: 2,
    });
  });

  it('ubica la cita en el día del negocio y no en el de UTC', () => {
    // Las 22:00 del 24 en Bolivia son las 02:00 del 25 en UTC: agrupando por
    // fecha UTC, la última cita de la tarde aparecería en el día siguiente.
    const timeline = build({
      from: '2026-08-24',
      to: '2026-08-25',
      entries: [entry('2026-08-24', '22:00', 90)],
    });

    expect(timeline?.buckets[0].revenue).toBe(90);
    expect(timeline?.buckets[1].revenue).toBe(0);
  });

  it('pasa a meses cuando el rango es largo', () => {
    const timeline = build({ from: '2026-01-01', to: '2026-12-31' });

    expect(timeline?.granularity).toBe('month');
    expect(timeline?.buckets).toHaveLength(12);
    expect(timeline?.buckets[0].key).toBe('2026-01');
    expect(timeline?.buckets[11].key).toBe('2026-12');
  });

  it('suma dentro del mes cuando agrupa por mes', () => {
    const timeline = build({
      from: '2026-01-01',
      to: '2026-12-31',
      entries: [
        entry('2026-03-02', '10:00', 100, 'a'),
        entry('2026-03-28', '10:00', 200, 'b'),
        entry('2026-04-01', '10:00', 50, 'c'),
      ],
    });

    const marzo = timeline?.buckets.find((b) => b.key === '2026-03');
    expect(marzo).toEqual({ key: '2026-03', revenue: 300, completed: 2 });
  });

  it('el límite diario son dos meses', () => {
    // 62 días entran como barras; 63 ya no.
    expect(build({ from: '2026-01-01', to: '2026-03-03' })?.granularity).toBe(
      'day',
    );
    expect(build({ from: '2026-01-01', to: '2026-03-04' })?.granularity).toBe(
      'month',
    );
  });

  it('redondea la plata a dos decimales', () => {
    const timeline = build({
      from: '2026-08-24',
      to: '2026-08-25',
      entries: [
        entry('2026-08-24', '10:00', 0.1, 'a'),
        entry('2026-08-24', '11:00', 0.2, 'b'),
      ],
    });

    // 0.1 + 0.2 en punto flotante es 0.30000000000000004.
    expect(timeline?.buckets[0].revenue).toBe(0.3);
  });

  it('ignora lo que cae fuera del rango en lugar de inventarle un tramo', () => {
    const timeline = build({
      from: '2026-08-24',
      to: '2026-08-25',
      entries: [entry('2026-09-01', '10:00', 500)],
    });

    expect(timeline?.buckets.every((b) => b.revenue === 0)).toBe(true);
  });

  it('cruza el fin de mes sin saltearse días', () => {
    const timeline = build({ from: '2026-08-30', to: '2026-09-02' });

    expect(timeline?.buckets.map((b) => b.key)).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
  });
});
