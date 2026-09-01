import { BadRequestException } from '@nestjs/common';
import { previousReportRange, resolveReportRange } from './report-range.util';

const LA_PAZ = 'America/La_Paz'; // UTC-4 todo el año

describe('resolveReportRange', () => {
  // 2026-03-15T02:00Z son las 22:00 del 14 de marzo en La Paz: el negocio
  // todavía está viviendo el sábado aunque en UTC ya sea domingo.
  const lateSaturdayNight = new Date('2026-03-15T02:00:00Z');

  it('acota "hoy" al día del negocio, no al del servidor', () => {
    const range = resolveReportRange(
      { preset: 'today' },
      LA_PAZ,
      lateSaturdayNight,
    );

    expect(range.from).toBe('2026-03-14');
    expect(range.to).toBe('2026-03-14');
    expect(range.startUtc.toISOString()).toBe('2026-03-14T04:00:00.000Z');
    expect(range.endUtc.toISOString()).toBe('2026-03-15T04:00:00.000Z');
  });

  it('toma la semana completa de lunes a domingo', () => {
    const range = resolveReportRange(
      { preset: 'week' },
      LA_PAZ,
      lateSaturdayNight,
    );

    expect(range.from).toBe('2026-03-09');
    expect(range.to).toBe('2026-03-15');
    expect(range.endUtc.toISOString()).toBe('2026-03-16T04:00:00.000Z');
  });

  it('toma el mes completo, sin cortar en el día de hoy', () => {
    const range = resolveReportRange(
      { preset: 'month' },
      LA_PAZ,
      lateSaturdayNight,
    );

    expect(range.from).toBe('2026-03-01');
    expect(range.to).toBe('2026-03-31');
  });

  it('resuelve el último día de un febrero no bisiesto', () => {
    const range = resolveReportRange(
      { preset: 'month' },
      LA_PAZ,
      new Date('2026-02-10T15:00:00Z'),
    );

    expect(range.to).toBe('2026-02-28');
  });

  it('incluye el día final del rango personalizado', () => {
    const range = resolveReportRange(
      { preset: 'custom', from: '2026-01-01', to: '2026-01-31' },
      LA_PAZ,
      lateSaturdayNight,
    );

    expect(range.startUtc.toISOString()).toBe('2026-01-01T04:00:00.000Z');
    expect(range.endUtc.toISOString()).toBe('2026-02-01T04:00:00.000Z');
  });

  it('acepta un rango personalizado de un solo día', () => {
    const range = resolveReportRange(
      { preset: 'custom', from: '2026-01-05', to: '2026-01-05' },
      LA_PAZ,
      lateSaturdayNight,
    );

    expect(range.endUtc.getTime() - range.startUtc.getTime()).toBe(
      24 * 60 * 60 * 1000,
    );
  });

  it('usa "hoy" cuando no se envía preset', () => {
    const range = resolveReportRange({}, LA_PAZ, lateSaturdayNight);

    expect(range.from).toBe('2026-03-14');
  });

  it('rechaza un rango personalizado incompleto', () => {
    expect(() =>
      resolveReportRange(
        { preset: 'custom', from: '2026-01-01' },
        LA_PAZ,
        lateSaturdayNight,
      ),
    ).toThrow(BadRequestException);
  });

  it('rechaza un rango invertido', () => {
    expect(() =>
      resolveReportRange(
        { preset: 'custom', from: '2026-02-01', to: '2026-01-01' },
        LA_PAZ,
        lateSaturdayNight,
      ),
    ).toThrow(BadRequestException);
  });

  it('respeta la zona horaria del negocio', () => {
    const range = resolveReportRange(
      { preset: 'today' },
      'Europe/Madrid',
      new Date('2026-03-15T02:00:00Z'),
    );

    // En Madrid ya es 15 de marzo, y su medianoche cae una hora antes que en UTC.
    expect(range.from).toBe('2026-03-15');
    expect(range.startUtc.toISOString()).toBe('2026-03-14T23:00:00.000Z');
  });
});

describe('previousReportRange', () => {
  const lateSaturdayNight = new Date('2026-03-15T02:00:00Z');

  /** El período anterior al que resuelve `preset` en ese instante. */
  const previousOf = (
    preset: 'today' | 'week' | 'month' | 'custom',
    from?: string,
    to?: string,
    now: Date = lateSaturdayNight,
  ) => {
    const range = resolveReportRange({ preset, from, to }, LA_PAZ, now);
    return previousReportRange(range, preset, LA_PAZ);
  };

  it('compara hoy contra ayer', () => {
    const previous = previousOf('today');

    expect(previous.from).toBe('2026-03-13');
    expect(previous.to).toBe('2026-03-13');
  });

  it('compara la semana contra la anterior completa', () => {
    const previous = previousOf('week');

    // La actual es 09-15; la anterior es el lunes a domingo que la precede.
    expect(previous.from).toBe('2026-03-02');
    expect(previous.to).toBe('2026-03-08');
  });

  it('compara el mes contra el mes de calendario anterior, no contra 31 días atrás', () => {
    const previous = previousOf('month');

    expect(previous.from).toBe('2026-02-01');
    expect(previous.to).toBe('2026-02-28');
  });

  it('cruza el año al retroceder desde enero', () => {
    const previous = previousOf(
      'month',
      undefined,
      undefined,
      new Date('2026-01-10T15:00:00Z'),
    );

    expect(previous.from).toBe('2025-12-01');
    expect(previous.to).toBe('2025-12-31');
  });

  it('compara un rango a medida contra la misma cantidad de días previos', () => {
    const previous = previousOf('custom', '2026-03-10', '2026-03-14');

    // Cinco días, así que los cinco que terminan justo antes del 10.
    expect(previous.from).toBe('2026-03-05');
    expect(previous.to).toBe('2026-03-09');
  });

  it('deja el período anterior pegado al actual, sin huecos ni solapamiento', () => {
    const range = resolveReportRange(
      { preset: 'week' },
      LA_PAZ,
      lateSaturdayNight,
    );
    const previous = previousReportRange(range, 'week', LA_PAZ);

    expect(previous.endUtc.toISOString()).toBe(range.startUtc.toISOString());
  });

  it('le da al período anterior la misma duración que al actual', () => {
    const range = resolveReportRange(
      { preset: 'custom', from: '2026-03-01', to: '2026-03-09' },
      LA_PAZ,
      lateSaturdayNight,
    );
    const previous = previousReportRange(range, 'custom', LA_PAZ);

    expect(previous.endUtc.getTime() - previous.startUtc.getTime()).toBe(
      range.endUtc.getTime() - range.startUtc.getTime(),
    );
  });
});
