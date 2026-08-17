import { BadRequestException } from '@nestjs/common';
import { resolveReportRange } from './report-range.util';

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
