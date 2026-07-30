import {
  addDaysToIsoDate,
  formatDateLabel,
  formatTimeLabel,
  todayIsoDateIn,
} from './booking-date.util';

describe('todayIsoDateIn', () => {
  it('devuelve la fecha local del negocio, no la UTC', () => {
    // 03:00 UTC del 31 es todavía el 30 en La Paz (UTC-4).
    const instant = new Date('2026-07-31T03:00:00.000Z');

    expect(todayIsoDateIn('America/La_Paz', instant)).toBe('2026-07-30');
    expect(todayIsoDateIn('UTC', instant)).toBe('2026-07-31');
  });
});

describe('addDaysToIsoDate', () => {
  it('suma días dentro del mes', () => {
    expect(addDaysToIsoDate('2026-07-30', 1)).toBe('2026-07-31');
  });

  it('cruza el fin de mes', () => {
    expect(addDaysToIsoDate('2026-07-31', 1)).toBe('2026-08-01');
  });

  it('cruza el fin de año', () => {
    expect(addDaysToIsoDate('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('maneja años bisiestos', () => {
    expect(addDaysToIsoDate('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysToIsoDate('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('no se corre por cambios de horario de verano', () => {
    // En zonas con DST, sumar un día calendario debe seguir dando el día siguiente.
    expect(addDaysToIsoDate('2026-10-17', 1)).toBe('2026-10-18');
    expect(addDaysToIsoDate('2026-03-28', 1)).toBe('2026-03-29');
  });

  it('acepta desplazamientos grandes', () => {
    expect(addDaysToIsoDate('2026-07-30', 14)).toBe('2026-08-13');
  });
});

describe('formatDateLabel', () => {
  it('produce una etiqueta corta y estable', () => {
    // El 31 de julio de 2026 es viernes.
    expect(formatDateLabel('2026-07-31')).toContain('31');
    expect(formatDateLabel('2026-07-31').toLowerCase()).toContain('vie');
  });

  it('cabe en el límite de título de fila de WhatsApp', () => {
    expect(formatDateLabel('2026-12-31').length).toBeLessThanOrEqual(24);
  });
});

describe('formatTimeLabel', () => {
  it('formatea en la zona del negocio', () => {
    const instant = new Date('2026-07-31T19:00:00.000Z');

    expect(formatTimeLabel(instant, 'America/La_Paz')).toBe('15:00');
    expect(formatTimeLabel(instant, 'UTC')).toBe('19:00');
  });
});
