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

/** Un instante suelto del día de prueba. */
const at = (time: string): Date => range(time, time).startTime;

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
    const slots = calculator.generateCandidateSlots({
      workingRanges: [range('09:00', '11:00')],
      durationMinutes: 30,
      stepMinutes: 30,
    });

    expect(starts(slots)).toEqual(['09:00', '09:30', '10:00', '10:30']);
  });

  it('no ofrece el que se pasa del cierre', () => {
    const slots = calculator.generateCandidateSlots({
      workingRanges: [range('09:00', '10:00')],
      durationMinutes: 45,
      stepMinutes: 30,
    });

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
    const slots = calculator.generateCandidateSlots({
      workingRanges: [range('09:00', '18:15')],
      durationMinutes: 30,
      stepMinutes: 30,
    });

    expect(starts(slots).slice(-3)).toEqual(['17:00', '17:30', '17:45']);
    expect(slots[slots.length - 1].endTime).toEqual(
      range('18:15', '18:15').startTime,
    );
  });

  it('no lo repite cuando el cierre ya cae en el paso', () => {
    const slots = calculator.generateCandidateSlots({
      workingRanges: [range('09:00', '11:00')],
      durationMinutes: 30,
      stepMinutes: 30,
    });

    expect(starts(slots).filter((start) => start === '10:30')).toHaveLength(1);
  });

  it('no inventa uno que no entra en la franja', () => {
    const slots = calculator.generateCandidateSlots({
      workingRanges: [range('09:00', '09:20')],
      durationMinutes: 30,
      stepMinutes: 30,
    });

    expect(slots).toEqual([]);
  });

  it('lo agrega en cada franja de un turno partido', () => {
    const slots = calculator.generateCandidateSlots({
      workingRanges: [range('09:00', '13:15'), range('15:00', '19:15')],
      durationMinutes: 60,
      stepMinutes: 60,
    });

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
    const slots = calculator.generateCandidateSlots({
      workingRanges: [range('09:00', '09:40')],
      durationMinutes: 30,
      stepMinutes: 30,
    });

    expect(starts(slots)).toEqual(['09:00', '09:10']);
  });

  it('sin franjas no hay nada que ofrecer', () => {
    expect(
      calculator.generateCandidateSlots({
        workingRanges: [],
        durationMinutes: 30,
        stepMinutes: 30,
      }),
    ).toEqual([]);
  });

  describe('con desborde, que es lo que pide el panel', () => {
    it('genera los que empiezan dentro aunque terminen después', () => {
      const slots = calculator.generateCandidateSlots({
        workingRanges: [range('09:00', '10:00')],
        durationMinutes: 45,
        stepMinutes: 30,
        allowOverflow: true,
      });

      expect(starts(slots)).toEqual(['09:00', '09:15', '09:30']);
    });
  });

  /**
   * Los anclajes: dónde termina cada cita ya agendada.
   *
   * Es lo que permite llenar el hueco que deja un servicio cuya duración no es
   * múltiplo del paso. Sin ellos, una barbería con barbas de 20 minutos hace 20
   * citas en un día que aguantaba 30.
   */
  describe('anclajes al final de cada cita', () => {
    it('ofrece el horario que arranca justo cuando termina una cita', () => {
      const slots = calculator.generateCandidateSlots({
        workingRanges: [range('09:00', '12:00')],
        durationMinutes: 20,
        stepMinutes: 30,
        anchors: [at('09:20')],
      });

      expect(starts(slots)).toContain('09:20');
    });

    it('no lo repite si el paso ya lo generó', () => {
      const slots = calculator.generateCandidateSlots({
        workingRanges: [range('09:00', '12:00')],
        durationMinutes: 30,
        stepMinutes: 30,
        anchors: [at('09:30')],
      });

      expect(starts(slots).filter((start) => start === '09:30')).toHaveLength(
        1,
      );
    });

    it('descarta el anclaje que no entra antes de cerrar', () => {
      const slots = calculator.generateCandidateSlots({
        workingRanges: [range('09:00', '12:00')],
        durationMinutes: 30,
        stepMinutes: 30,
        // Termina 12:10, con el local cerrado.
        anchors: [at('11:40')],
      });

      expect(starts(slots)).not.toContain('11:40');
    });

    it('descarta el anclaje que cae fuera de toda franja', () => {
      const slots = calculator.generateCandidateSlots({
        workingRanges: [range('09:00', '12:00'), range('15:00', '18:00')],
        durationMinutes: 30,
        stepMinutes: 60,
        // En el hueco del mediodía: el local no atiende.
        anchors: [at('13:20')],
      });

      expect(starts(slots)).not.toContain('13:20');
    });

    it('los deja en orden entre los horarios de la grilla', () => {
      const slots = calculator.generateCandidateSlots({
        workingRanges: [range('09:00', '11:00')],
        durationMinutes: 30,
        stepMinutes: 30,
        anchors: [at('10:20'), at('09:20')],
      });

      expect(starts(slots)).toEqual([
        '09:00',
        '09:20',
        '09:30',
        '10:00',
        '10:20',
        '10:30',
      ]);
    });

    /*
     * La jornada llena de citas de 20 minutos: con la grilla sola entran 6 en
     * tres horas y el día aguantaba 9.
     */
    it('recupera las citas que el paso dejaba afuera', () => {
      const anchors: Date[] = [];
      for (let minute = 20; minute < 180; minute += 20) {
        anchors.push(
          new Date(
            range('09:00', '12:00').startTime.getTime() + minute * 60_000,
          ),
        );
      }

      const conAnclajes = calculator.generateCandidateSlots({
        workingRanges: [range('09:00', '12:00')],
        durationMinutes: 20,
        stepMinutes: 30,
        anchors,
      });

      const sinAnclajes = calculator.generateCandidateSlots({
        workingRanges: [range('09:00', '12:00')],
        durationMinutes: 20,
        stepMinutes: 30,
      });

      expect(starts(sinAnclajes)).not.toContain('09:20');
      expect(starts(conAnclajes)).toContain('09:20');
      expect(starts(conAnclajes)).toContain('11:40');
    });
  });
});
