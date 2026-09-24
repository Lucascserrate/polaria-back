import { AvailabilityCalculator } from './availability.calculator';
import type { SlotRange } from './utils/availability.types';

/**
 * La grilla de horarios candidatos.
 *
 * Es el piso de todo el cálculo de disponibilidad: un horario que no se genera
 * acá no existe para nadie más abajo, y su ausencia no falla ni se registra
 * —simplemente no se ofrece—. Por eso se prueba aparte de quien después lo
 * filtra por jornada y por agenda.
 */

const calculator = new AvailabilityCalculator();

/** Franja del día de prueba, en UTC para no mezclar zonas horarias acá. */
const range = (from: string, to: string): SlotRange => {
  const at = (time: string) => {
    const [hour, minute] = time.split(':').map(Number);
    return new Date(Date.UTC(2026, 8, 23, hour, minute));
  };

  return { startTime: at(from), endTime: at(to) };
};

const starts = (slots: SlotRange[]): string[] =>
  slots.map((slot) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(slot.startTime),
  );

describe('generateCandidateSlots', () => {
  it('avanza de a un paso desde la apertura', () => {
    const slots = calculator.generateCandidateSlots(
      [range('09:00', '11:00')],
      30,
      30,
    );

    expect(starts(slots)).toEqual(['09:00', '09:30', '10:00', '10:30']);
  });

  it('no ofrece el que se pasa del cierre', () => {
    const slots = calculator.generateCandidateSlots(
      [range('09:00', '10:00')],
      45,
      30,
    );

    // 09:30 terminaría 10:15, con el local cerrado. 09:15 termina justo.
    expect(starts(slots)).toEqual(['09:00', '09:15']);
  });

  /**
   * El caso que trajo un negocio real.
   *
   * Cierra 18:15 en lugar de 18:00 justamente para poder atender a alguien más
   * al final del día. Con la grilla arrancando en la apertura y avanzando de a
   * media hora, el último horario era 17:30 y las 17:45 —que entran enteras, y
   * terminan justo al cerrar— no existían. A las 17:30, con la anticipación
   * mínima, eso dejaba el día sin un solo horario con el local abierto.
   */
  it('ofrece el horario que termina justo al cierre, aunque no caiga en el paso', () => {
    const slots = calculator.generateCandidateSlots(
      [range('09:00', '18:15')],
      30,
      30,
    );

    expect(starts(slots).slice(-3)).toEqual(['17:00', '17:30', '17:45']);
    expect(slots[slots.length - 1].endTime).toEqual(
      range('18:15', '18:15').startTime,
    );
  });

  it('no lo repite cuando el cierre ya cae en el paso', () => {
    const slots = calculator.generateCandidateSlots(
      [range('09:00', '11:00')],
      30,
      30,
    );

    expect(starts(slots).filter((start) => start === '10:30')).toHaveLength(1);
  });

  it('no inventa uno que no entra en la franja', () => {
    const slots = calculator.generateCandidateSlots(
      [range('09:00', '09:20')],
      30,
      30,
    );

    expect(slots).toEqual([]);
  });

  it('lo agrega en cada franja de un turno partido', () => {
    const slots = calculator.generateCandidateSlots(
      [range('09:00', '13:15'), range('15:00', '19:15')],
      60,
      60,
    );

    expect(starts(slots)).toEqual([
      '09:00',
      '10:00',
      '11:00',
      '12:00',
      '12:15',
      '15:00',
      '16:00',
      '17:00',
      '18:00',
      '18:15',
    ]);
  });

  /*
   * Una franja que da para un servicio y monedas: el horario de cierre arranca
   * antes que el último que generó el paso, y la lista tiene que salir en orden
   * igual. Desordenada, la pantalla de horarios se ve desordenada.
   */
  it('devuelve los horarios en orden aunque el del cierre caiga antes', () => {
    const slots = calculator.generateCandidateSlots(
      [range('09:00', '09:40')],
      30,
      30,
    );

    expect(starts(slots)).toEqual(['09:00', '09:10']);
  });

  it('sin franjas no hay nada que ofrecer', () => {
    expect(calculator.generateCandidateSlots([], 30, 30)).toEqual([]);
  });

  describe('con desborde, que es lo que pide el panel', () => {
    it('genera los que empiezan dentro aunque terminen después', () => {
      const slots = calculator.generateCandidateSlots(
        [range('09:00', '10:00')],
        45,
        30,
        true,
      );

      expect(starts(slots)).toEqual(['09:00', '09:15', '09:30']);
    });
  });
});
