import type { SlotRange } from '../utils/availability.types';
import {
  buildBookingSlots as buildSlots,
  findBookingSlotAt,
  hasAnyBookingSlot as hasAnySlot,
  type BuildBookingSlotsInput,
} from './slot-builder';

/**
 * Casi todo este archivo prueba una reserva de **un** servicio, que es la de
 * WhatsApp, la del Flow y la del panel. Ahí el bloque y el servicio son lo
 * mismo, así que el tramo se arma solo: ocupa el candidato entero.
 *
 * El adaptador existe para que estas pruebas sigan diciendo exactamente lo que
 * decían antes de que una reserva pudiera llevar varios servicios. Que no haya
 * que tocarlas **es** la afirmación que sostienen: para un servicio no cambió
 * nada. Lo de varios tiene su propio `describe` al final, con los tramos
 * escritos a mano.
 */
type SingleServiceInput = Omit<BuildBookingSlotsInput, 'segments'> & {
  staffIds: string[];
};

function asOneService(input: SingleServiceInput): BuildBookingSlotsInput {
  const { staffIds, ...rest } = input;
  const [candidate] = input.candidateSlots;

  return {
    ...rest,
    segments: [
      {
        staffIds,
        offsetMinutes: 0,
        durationMinutes: candidate
          ? (candidate.endTime.getTime() - candidate.startTime.getTime()) /
            60_000
          : 30,
      },
    ],
  };
}

const buildBookingSlots = (input: SingleServiceInput) =>
  buildSlots(asOneService(input));

const hasAnyBookingSlot = (input: SingleServiceInput) =>
  hasAnySlot(asOneService(input));

const NICO = 'aaaa-nico';
const ANA = 'bbbb-ana';
const RAUL = 'cccc-raul';

/** Slot del 2026-07-31 a la hora indicada, en UTC para simplificar el test. */
function at(hour: number, minute = 0, durationMinutes = 30): SlotRange {
  const startTime = new Date(Date.UTC(2026, 6, 31, hour, minute, 0));
  return {
    startTime,
    endTime: new Date(startTime.getTime() + durationMinutes * 60_000),
  };
}

function candidates(...ranges: SlotRange[]): SlotRange[] {
  return ranges;
}

/** Jornada de `fromHour` a `toHour` del día de prueba. */
function shift(fromHour: number, toHour: number): SlotRange[] {
  return [
    {
      startTime: new Date(Date.UTC(2026, 6, 31, fromHour, 0, 0)),
      endTime: new Date(Date.UTC(2026, 6, 31, toHour, 0, 0)),
    },
  ];
}

/** Jornada completa, para los casos que no ejercitan el horario. */
function allDay(...staffIds: string[]): Record<string, SlotRange[]> {
  return Object.fromEntries(staffIds.map((id) => [id, shift(0, 24)]));
}

describe('buildBookingSlots', () => {
  it('devuelve todos los slots libres, sin recortar a N ni exigir separación', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(
        at(9),
        at(9, 15),
        at(9, 30),
        at(9, 45),
        at(10),
      ),
      staffIds: [NICO],
      workingRangesByStaff: allDay(NICO),
      appointmentsByStaff: { [NICO]: [] },
    });

    expect(slots).toHaveLength(5);
    expect(slots.map((slot) => slot.startTime.getUTCHours())).toEqual([
      9, 9, 9, 9, 10,
    ]);
  });

  it('conserva todos los profesionales libres en el mismo horario', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(15)),
      staffIds: [NICO, ANA],
      workingRangesByStaff: allDay(NICO, ANA),
      appointmentsByStaff: { [NICO]: [], [ANA]: [] },
    });

    expect(slots).toHaveLength(1);
    expect(slots[0].eligibleStaffIds).toEqual([NICO, ANA]);
  });

  it('excluye al profesional ocupado pero conserva el horario si otro está libre', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(15)),
      staffIds: [NICO, ANA],
      workingRangesByStaff: allDay(NICO, ANA),
      appointmentsByStaff: {
        [NICO]: [at(15)],
        [ANA]: [],
      },
    });

    expect(slots).toHaveLength(1);
    expect(slots[0].eligibleStaffIds).toEqual([ANA]);
  });

  it('descarta el horario solo cuando ningún profesional está libre', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(15)),
      staffIds: [NICO, ANA],
      workingRangesByStaff: allDay(NICO, ANA),
      appointmentsByStaff: {
        [NICO]: [at(15)],
        [ANA]: [at(15)],
      },
    });

    expect(slots).toEqual([]);
  });

  it('considera ocupado un solapamiento parcial', () => {
    const slots = buildBookingSlots({
      // Slot de 15:00 a 15:30 contra una cita de 15:15 a 15:45.
      candidateSlots: candidates(at(15, 0, 30)),
      staffIds: [NICO],
      workingRangesByStaff: allDay(NICO),
      appointmentsByStaff: { [NICO]: [at(15, 15, 30)] },
    });

    expect(slots).toEqual([]);
  });

  it('no considera ocupado un horario que empieza justo cuando termina una cita', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(15, 30, 30)),
      staffIds: [NICO],
      workingRangesByStaff: allDay(NICO),
      appointmentsByStaff: { [NICO]: [at(15, 0, 30)] },
    });

    expect(slots).toHaveLength(1);
  });

  it('descarta los horarios anteriores a minStartTime', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(9), at(10), at(11)),
      staffIds: [NICO],
      workingRangesByStaff: allDay(NICO),
      appointmentsByStaff: { [NICO]: [] },
      minStartTime: new Date(Date.UTC(2026, 6, 31, 10, 0, 0)),
    });

    expect(slots.map((slot) => slot.startTime.getUTCHours())).toEqual([10, 11]);
  });

  it('devuelve vacío sin profesionales habilitados', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(9)),
      staffIds: [],
      workingRangesByStaff: {},
      appointmentsByStaff: {},
    });

    expect(slots).toEqual([]);
  });

  it('ordena los profesionales elegibles por id, sin importar el orden de entrada', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(9)),
      staffIds: [RAUL, NICO, ANA],
      workingRangesByStaff: allDay(RAUL, NICO, ANA),
      appointmentsByStaff: {},
    });

    expect(slots[0].eligibleStaffIds).toEqual([NICO, ANA, RAUL]);
  });

  it('ordena los horarios cronológicamente aunque lleguen desordenados', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(16), at(9), at(12)),
      staffIds: [NICO],
      workingRangesByStaff: allDay(NICO),
      appointmentsByStaff: {},
    });

    expect(slots.map((slot) => slot.startTime.getUTCHours())).toEqual([
      9, 12, 16,
    ]);
  });

  it('trata un profesional sin entrada en el mapa de citas como libre', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(9)),
      staffIds: [NICO],
      workingRangesByStaff: allDay(NICO),
      appointmentsByStaff: {},
    });

    expect(slots[0].eligibleStaffIds).toEqual([NICO]);
  });

  describe('jornada de cada profesional', () => {
    it('ofrece en cada horario solo a quien está en el local a esa hora', () => {
      const input = {
        staffIds: [NICO, ANA],
        // Turno de mañana y turno de tarde.
        workingRangesByStaff: { [NICO]: shift(9, 17), [ANA]: shift(13, 21) },
        appointmentsByStaff: {},
      };

      const morning = buildBookingSlots({
        ...input,
        candidateSlots: candidates(at(9)),
      });
      const overlap = buildBookingSlots({
        ...input,
        candidateSlots: candidates(at(14)),
      });
      const evening = buildBookingSlots({
        ...input,
        candidateSlots: candidates(at(19)),
      });

      expect(morning[0].eligibleStaffIds).toEqual([NICO]);
      expect(overlap[0].eligibleStaffIds).toEqual([NICO, ANA]);
      expect(evening[0].eligibleStaffIds).toEqual([ANA]);
    });

    it('descarta el horario que no cubre nadie', () => {
      const slots = buildBookingSlots({
        candidateSlots: candidates(at(8)),
        staffIds: [NICO, ANA],
        workingRangesByStaff: { [NICO]: shift(9, 17), [ANA]: shift(13, 21) },
        appointmentsByStaff: {},
      });

      expect(slots).toEqual([]);
    });

    it('no ofrece un servicio que terminaría después del fin de la jornada', () => {
      const slots = buildBookingSlots({
        // Corte de 60 minutos arrancando a las 16:45, con salida a las 17:00.
        candidateSlots: candidates(at(16, 45, 60)),
        staffIds: [NICO],
        workingRangesByStaff: { [NICO]: shift(9, 17) },
        appointmentsByStaff: {},
      });

      expect(slots).toEqual([]);
    });

    it('no ofrece a un profesional ausente del mapa de jornadas', () => {
      const slots = buildBookingSlots({
        candidateSlots: candidates(at(10)),
        staffIds: [NICO],
        workingRangesByStaff: {},
        appointmentsByStaff: {},
      });

      expect(slots).toEqual([]);
    });

    it('no ofrece a un profesional que no trabaja ese día', () => {
      const slots = buildBookingSlots({
        candidateSlots: candidates(at(10)),
        staffIds: [NICO, ANA],
        workingRangesByStaff: { [NICO]: [], [ANA]: shift(9, 17) },
        appointmentsByStaff: {},
      });

      expect(slots[0].eligibleStaffIds).toEqual([ANA]);
    });
  });
});

describe('hasAnyBookingSlot', () => {
  it('responde si el servicio tiene algún hueco ese día', () => {
    const input = {
      candidateSlots: candidates(at(15)),
      staffIds: [NICO],
      workingRangesByStaff: allDay(NICO),
      appointmentsByStaff: { [NICO]: [at(15)] },
    };

    expect(hasAnyBookingSlot(input)).toBe(false);
    expect(hasAnyBookingSlot({ ...input, appointmentsByStaff: {} })).toBe(true);
  });
});

describe('findBookingSlotAt', () => {
  it('encuentra el slot por instante exacto de inicio', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(9), at(10)),
      staffIds: [NICO],
      workingRangesByStaff: allDay(NICO),
      appointmentsByStaff: {},
    });

    const found = findBookingSlotAt(
      slots,
      new Date(Date.UTC(2026, 6, 31, 10, 0, 0)),
    );

    expect(found?.startTime.getUTCHours()).toBe(10);
  });

  it('devuelve null si el horario ya no está en la lista', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(9)),
      staffIds: [NICO],
      workingRangesByStaff: allDay(NICO),
      appointmentsByStaff: {},
    });

    expect(
      findBookingSlotAt(slots, new Date(Date.UTC(2026, 6, 31, 10, 0, 0))),
    ).toBeNull();
  });
});

/**
 * El horario que empieza dentro de la atención y termina después.
 *
 * Es el caso del mostrador: el local cierra a las 17:00, entra alguien a las
 * 16:30 y el servicio dura una hora. No ofrecerlo obligaba a mover el horario de
 * atención para poder agendarlo; ofrecerlo sin marca escondería que se pasa.
 */
describe('buildBookingSlots con horarios que se pasan del cierre', () => {
  const closesAtFive = { [NICO]: shift(9, 17) };

  it('no los ofrece por defecto', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(16, 30, 60)),
      staffIds: [NICO],
      workingRangesByStaff: closesAtFive,
      appointmentsByStaff: { [NICO]: [] },
    });

    expect(slots).toEqual([]);
  });

  it('los ofrece marcados cuando se le permite', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(16, 30, 60)),
      staffIds: [NICO],
      workingRangesByStaff: closesAtFive,
      appointmentsByStaff: { [NICO]: [] },
      allowEndAfterHours: true,
    });

    expect(slots).toHaveLength(1);
    expect(slots[0].endsAfterHours).toBe(true);
    expect(slots[0].eligibleStaffIds).toEqual([NICO]);
  });

  it('el que entra entero no lleva marca', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(15, 30, 60)),
      staffIds: [NICO],
      workingRangesByStaff: closesAtFive,
      appointmentsByStaff: { [NICO]: [] },
      allowEndAfterHours: true,
    });

    expect(slots).toHaveLength(1);
    expect(slots[0].endsAfterHours).toBeUndefined();
  });

  it('empezar con el local ya cerrado no se ofrece', () => {
    // El final de la jornada es exclusivo: a las 17:00 ya no se atiende, así que
    // no hay nada que "pasarse".
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(17, 0, 60)),
      staffIds: [NICO],
      workingRangesByStaff: closesAtFive,
      appointmentsByStaff: { [NICO]: [] },
      allowEndAfterHours: true,
    });

    expect(slots).toEqual([]);
  });

  it('pasarse del cierre no habilita pisar otra cita', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(16, 30, 60)),
      staffIds: [NICO],
      workingRangesByStaff: closesAtFive,
      appointmentsByStaff: { [NICO]: [at(16, 30, 30)] },
      allowEndAfterHours: true,
    });

    expect(slots).toEqual([]);
  });

  /*
   * Si alguien del equipo lo cubre entero, el horario es normal para quien lo va
   * a atender: marcarlo diría que se pasa un horario que no se pasa.
   */
  it('con alguien que lo cubre entero, el horario va sin marca y es suyo', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(16, 30, 60)),
      staffIds: [NICO, ANA],
      workingRangesByStaff: { [NICO]: shift(9, 17), [ANA]: shift(9, 20) },
      appointmentsByStaff: { [NICO]: [], [ANA]: [] },
      allowEndAfterHours: true,
    });

    expect(slots).toHaveLength(1);
    expect(slots[0].endsAfterHours).toBeUndefined();
    expect(slots[0].eligibleStaffIds).toEqual([ANA]);
  });
});

/**
 * Una reserva de varios servicios, que es lo que hace la página pública cuando
 * el cliente agrega un segundo servicio a la misma cita.
 *
 * Acá los tramos se escriben a mano: el bloque dura la suma, y cada servicio
 * ocupa su pedazo a partir de su `offsetMinutes`. Lo que estas pruebas fijan es
 * que la disponibilidad de cada tramo se resuelva por separado —los tramos no se
 * pisan— y que "uno para toda la reserva" sea una exigencia y no una casualidad.
 */
describe('buildBookingSlots con varios servicios', () => {
  /** Corte de 30' y barba de 30': un bloque de una hora desde las 15:00. */
  const corteYBarba = (corte: string[], barba: string[]) => ({
    candidateSlots: candidates(at(15, 0, 60)),
    segments: [
      { staffIds: corte, offsetMinutes: 0, durationMinutes: 30 },
      { staffIds: barba, offsetMinutes: 30, durationMinutes: 30 },
    ],
  });

  it('ofrece el bloque cuando una sola persona puede con los dos', () => {
    const slots = buildSlots({
      ...corteYBarba([NICO], [NICO]),
      workingRangesByStaff: allDay(NICO),
      appointmentsByStaff: { [NICO]: [] },
      requireSingleStaff: true,
    });

    expect(slots).toHaveLength(1);
    expect(slots[0].eligibleStaffIds).toEqual([NICO]);
    expect(slots[0].eligibleStaffIdsBySegment).toEqual([[NICO], [NICO]]);
  });

  /*
   * El caso que justifica que el bloque se mida entero: el segundo tramo cae
   * sobre una cita que ya existe, y el primero está libre. Sin mirar los dos, el
   * horario se ofrecería y la reserva se caería al confirmar.
   */
  it('no ofrece el bloque si el segundo tramo está ocupado', () => {
    const slots = buildSlots({
      ...corteYBarba([NICO], [NICO]),
      workingRangesByStaff: allDay(NICO),
      // 15:30 es exactamente donde arranca la barba.
      appointmentsByStaff: { [NICO]: [at(15, 30, 30)] },
      requireSingleStaff: true,
    });

    expect(slots).toEqual([]);
  });

  /*
   * Repartir la reserva entre dos personas es legítimo, pero hay que pedirlo.
   * Quien no eligió profesional no está pidiendo que lo pasen de silla en silla,
   * y por eso el modo por defecto descarta este horario.
   */
  it('con dos personas distintas sólo lo ofrece si no se exige una sola', () => {
    const input = {
      ...corteYBarba([NICO], [ANA]),
      workingRangesByStaff: allDay(NICO, ANA),
      appointmentsByStaff: { [NICO]: [], [ANA]: [] },
    };

    expect(buildSlots({ ...input, requireSingleStaff: true })).toEqual([]);

    const repartido = buildSlots({ ...input, requireSingleStaff: false });
    expect(repartido).toHaveLength(1);
    expect(repartido[0].eligibleStaffIds).toEqual([]);
    expect(repartido[0].eligibleStaffIdsBySegment).toEqual([[NICO], [ANA]]);
  });

  /*
   * La jornada se mira contra el tramo, no contra el bloque: Nico se va a las
   * 15:30 y podría hacer el corte, pero no la barba. Que el bloque entre en el
   * horario de Ana no lo habilita a él.
   */
  it('mira la jornada de cada tramo, no la del bloque', () => {
    const slots = buildSlots({
      ...corteYBarba([NICO, ANA], [NICO, ANA]),
      workingRangesByStaff: {
        // Nico se va 15:30: llega al corte, no a la barba.
        [NICO]: [
          {
            startTime: new Date(Date.UTC(2026, 6, 31, 9, 0, 0)),
            endTime: new Date(Date.UTC(2026, 6, 31, 15, 30, 0)),
          },
        ],
        [ANA]: shift(9, 20),
      },
      appointmentsByStaff: { [NICO]: [], [ANA]: [] },
      requireSingleStaff: false,
    });

    expect(slots).toHaveLength(1);
    expect(slots[0].eligibleStaffIdsBySegment).toEqual([[NICO, ANA], [ANA]]);
    expect(slots[0].eligibleStaffIds).toEqual([ANA]);
  });
});
