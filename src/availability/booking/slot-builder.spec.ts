import type { SlotRange } from '../utils/availability.types';
import {
  buildBookingSlots,
  findBookingSlotAt,
  hasAnyBookingSlot,
} from './slot-builder';

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
      appointmentsByStaff: { [NICO]: [], [ANA]: [] },
    });

    expect(slots).toHaveLength(1);
    expect(slots[0].eligibleStaffIds).toEqual([NICO, ANA]);
  });

  it('excluye al profesional ocupado pero conserva el horario si otro está libre', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(15)),
      staffIds: [NICO, ANA],
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
      appointmentsByStaff: { [NICO]: [at(15, 15, 30)] },
    });

    expect(slots).toEqual([]);
  });

  it('no considera ocupado un horario que empieza justo cuando termina una cita', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(15, 30, 30)),
      staffIds: [NICO],
      appointmentsByStaff: { [NICO]: [at(15, 0, 30)] },
    });

    expect(slots).toHaveLength(1);
  });

  it('descarta los horarios anteriores a minStartTime', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(9), at(10), at(11)),
      staffIds: [NICO],
      appointmentsByStaff: { [NICO]: [] },
      minStartTime: new Date(Date.UTC(2026, 6, 31, 10, 0, 0)),
    });

    expect(slots.map((slot) => slot.startTime.getUTCHours())).toEqual([10, 11]);
  });

  it('devuelve vacío sin profesionales habilitados', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(9)),
      staffIds: [],
      appointmentsByStaff: {},
    });

    expect(slots).toEqual([]);
  });

  it('ordena los profesionales elegibles por id, sin importar el orden de entrada', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(9)),
      staffIds: [RAUL, NICO, ANA],
      appointmentsByStaff: {},
    });

    expect(slots[0].eligibleStaffIds).toEqual([NICO, ANA, RAUL]);
  });

  it('ordena los horarios cronológicamente aunque lleguen desordenados', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(16), at(9), at(12)),
      staffIds: [NICO],
      appointmentsByStaff: {},
    });

    expect(slots.map((slot) => slot.startTime.getUTCHours())).toEqual([
      9, 12, 16,
    ]);
  });

  it('trata un profesional sin entrada en el mapa como libre', () => {
    const slots = buildBookingSlots({
      candidateSlots: candidates(at(9)),
      staffIds: [NICO],
      appointmentsByStaff: {},
    });

    expect(slots[0].eligibleStaffIds).toEqual([NICO]);
  });
});

describe('hasAnyBookingSlot', () => {
  it('responde si el servicio tiene algún hueco ese día', () => {
    const input = {
      candidateSlots: candidates(at(15)),
      staffIds: [NICO],
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
      appointmentsByStaff: {},
    });

    expect(
      findBookingSlotAt(slots, new Date(Date.UTC(2026, 6, 31, 10, 0, 0))),
    ).toBeNull();
  });
});
