import type { SlotRange } from '../utils/availability.types';
import { buildBookingSlots, buildBookingSlotsForPlans } from './slot-builder';

/**
 * Lo que pasa cuando dos servicios de una reserva ocurren **a la vez**.
 *
 * Va en un archivo aparte de `slot-builder.spec.ts` a propósito: aquel sostiene
 * que para un servicio, y para varios encadenados, no cambió nada, y que no haya
 * que tocarlo es parte de lo que afirma. Acá se prueba lo que es nuevo.
 */

const NICO = 'aaaa-nico';
const ANA = 'bbbb-ana';

/** Slot del 2026-07-31 a la hora indicada, en UTC para simplificar el test. */
function at(hour: number, minute = 0, durationMinutes = 30): SlotRange {
  const startTime = new Date(Date.UTC(2026, 6, 31, hour, minute, 0));
  return {
    startTime,
    endTime: new Date(startTime.getTime() + durationMinutes * 60_000),
  };
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

const utc = (hour: number) => new Date(Date.UTC(2026, 6, 31, hour));

/**
 * El salón de uñas: manicure y pedicure a la vez.
 *
 * Los dos tramos comparten `roundIndex`, o sea que ocurren al mismo tiempo, y
 * por eso exigen personas distintas. El plan que los pone juntos lo arma
 * `buildExecutionPlans`; acá se prueba qué hace el motor cuando lo recibe.
 */
describe('buildBookingSlots con servicios simultáneos', () => {
  /** Manicure y pedicure de una hora, las dos desde las 15:00. */
  const aLaVez = (manicure: string[], pedicure: string[]) => ({
    candidateSlots: [at(15, 0, 60)],
    segments: [
      {
        staffIds: manicure,
        offsetMinutes: 0,
        durationMinutes: 60,
        roundIndex: 0,
      },
      {
        staffIds: pedicure,
        offsetMinutes: 0,
        durationMinutes: 60,
        roundIndex: 0,
      },
    ],
  });

  it('ofrece el bloque de una hora cuando hay dos profesionales', () => {
    const slots = buildBookingSlots({
      ...aLaVez([NICO], [ANA]),
      workingRangesByStaff: allDay(NICO, ANA),
      appointmentsByStaff: { [NICO]: [], [ANA]: [] },
    });

    expect(slots).toHaveLength(1);
    expect(slots[0].startTime).toEqual(utc(15));
    // Una hora, no dos: la reserva dura lo que el más largo de los dos.
    expect(slots[0].endTime).toEqual(utc(16));
  });

  /*
   * El caso que justifica el reparto. Nico puede hacer las dos cosas, así que
   * las dos listas de candidatos son no vacías; preguntar tramo por tramo diría
   * que el horario existe y la cita lo pondría en dos sillas a la misma hora.
   */
  it('no ofrece el bloque si la única persona habilitada es la misma', () => {
    const slots = buildBookingSlots({
      ...aLaVez([NICO], [NICO]),
      workingRangesByStaff: allDay(NICO),
      appointmentsByStaff: { [NICO]: [] },
    });

    expect(slots).toEqual([]);
  });

  /*
   * Poder hacer la manicure y poder hacer la pedicure no es poder hacer las dos
   * al mismo tiempo. Ofrecer a Nico como "una sola persona para todo" sería
   * ofrecer lo imposible, aunque esté en las dos listas.
   */
  it('nunca dice que alguien puede solo con una reserva simultánea', () => {
    const slots = buildBookingSlots({
      ...aLaVez([NICO, ANA], [NICO, ANA]),
      workingRangesByStaff: allDay(NICO, ANA),
      appointmentsByStaff: { [NICO]: [], [ANA]: [] },
    });

    expect(slots).toHaveLength(1);
    expect(slots[0].eligibleStaffIds).toEqual([]);
    expect(slots[0].eligibleStaffIdsBySegment).toEqual([
      [NICO, ANA],
      [NICO, ANA],
    ]);
  });

  /*
   * Pedir que una sola persona atienda dos servicios a la vez es pedir que el
   * plan no exista. Cuando el negocio declaró que las dos categorías conviven,
   * elegirlas juntas es haber pedido terminar antes.
   */
  it('ignora requireSingleStaff, que con tramos a la vez no significa nada', () => {
    const slots = buildBookingSlots({
      ...aLaVez([NICO], [ANA]),
      workingRangesByStaff: allDay(NICO, ANA),
      appointmentsByStaff: { [NICO]: [], [ANA]: [] },
      requireSingleStaff: true,
    });

    expect(slots).toHaveLength(1);
  });

  it('exige a las dos personas libres, no a una sola', () => {
    const slots = buildBookingSlots({
      ...aLaVez([NICO], [ANA]),
      workingRangesByStaff: allDay(NICO, ANA),
      // Ana tiene tomada justo esa hora.
      appointmentsByStaff: { [NICO]: [], [ANA]: [at(15, 0, 60)] },
    });

    expect(slots).toEqual([]);
  });

  it('exige a las dos en su jornada, no a una sola', () => {
    const slots = buildBookingSlots({
      ...aLaVez([NICO], [ANA]),
      workingRangesByStaff: { [NICO]: shift(9, 20), [ANA]: shift(9, 15) },
      appointmentsByStaff: { [NICO]: [], [ANA]: [] },
    });

    expect(slots).toEqual([]);
  });

  /*
   * Duraciones distintas: la tanda dura lo que la manicure, y la pedicure deja
   * a su profesional libre a la media hora. El bloque son 60 minutos, no 90.
   */
  it('el bloque dura lo que el tramo más largo de la tanda', () => {
    const slots = buildBookingSlots({
      candidateSlots: [at(15, 0, 60)],
      segments: [
        {
          staffIds: [NICO],
          offsetMinutes: 0,
          durationMinutes: 60,
          roundIndex: 0,
        },
        {
          staffIds: [ANA],
          offsetMinutes: 0,
          durationMinutes: 30,
          roundIndex: 0,
        },
      ],
      workingRangesByStaff: allDay(NICO, ANA),
      appointmentsByStaff: { [NICO]: [], [ANA]: [] },
    });

    expect(slots).toHaveLength(1);
    expect(slots[0].endTime).toEqual(utc(16));
  });
});

/**
 * El motor probando varias formas de acomodar la misma reserva.
 *
 * Es lo que hace que el salón con una sola profesional siga teniendo horarios:
 * el plan simultáneo no se puede cumplir y el encadenado sí, así que el horario
 * se ofrece igual, más largo.
 */
describe('buildBookingSlotsForPlans', () => {
  /** Los dos planes de una manicure y una pedicure de una hora cada una. */
  const planes = (manicure: string[], pedicure: string[]) => [
    {
      segments: [
        {
          staffIds: manicure,
          offsetMinutes: 0,
          durationMinutes: 60,
          roundIndex: 0,
        },
        {
          staffIds: pedicure,
          offsetMinutes: 0,
          durationMinutes: 60,
          roundIndex: 0,
        },
      ],
    },
    {
      segments: [
        {
          staffIds: manicure,
          offsetMinutes: 0,
          durationMinutes: 60,
          roundIndex: 0,
        },
        {
          staffIds: pedicure,
          offsetMinutes: 60,
          durationMinutes: 60,
          roundIndex: 1,
        },
      ],
    },
  ];

  it('con dos profesionales resuelve por el plan simultáneo', () => {
    const slots = buildBookingSlotsForPlans({
      candidateSlots: [at(15, 0, 60)],
      plans: planes([NICO], [ANA]),
      workingRangesByStaff: allDay(NICO, ANA),
      appointmentsByStaff: { [NICO]: [], [ANA]: [] },
    });

    expect(slots).toHaveLength(1);
    expect(slots[0].planIndex).toBe(0);
    expect(slots[0].endTime).toEqual(utc(16));
  });

  it('con una sola profesional cae al encadenado y el bloque dura el doble', () => {
    const slots = buildBookingSlotsForPlans({
      candidateSlots: [at(15, 0, 60)],
      plans: planes([NICO], [NICO]),
      workingRangesByStaff: allDay(NICO),
      appointmentsByStaff: { [NICO]: [] },
    });

    expect(slots).toHaveLength(1);
    expect(slots[0].planIndex).toBe(1);
    expect(slots[0].endTime).toEqual(utc(17));
  });

  /*
   * La consecuencia buscada: la lista tiene horarios de distinta duración. A
   * las 15:00 están las dos y la reserva dura una hora; a las 18:00 Ana ya se
   * fue, así que el mismo pedido dura dos. Esconder el de las 18:00 sería
   * esconder un horario que existe.
   */
  it('mezcla duraciones según lo que cada momento del día permite', () => {
    const slots = buildBookingSlotsForPlans({
      candidateSlots: [at(15, 0, 60), at(18, 0, 60)],
      plans: planes([NICO], [NICO, ANA]),
      workingRangesByStaff: { [NICO]: shift(9, 22), [ANA]: shift(9, 17) },
      appointmentsByStaff: { [NICO]: [], [ANA]: [] },
    });

    expect(slots).toHaveLength(2);

    expect(slots[0].planIndex).toBe(0);
    expect(slots[0].endTime).toEqual(utc(16));

    expect(slots[1].planIndex).toBe(1);
    expect(slots[1].endTime).toEqual(utc(20));
  });

  it('sin ningún plan cumplible no ofrece el horario', () => {
    const slots = buildBookingSlotsForPlans({
      candidateSlots: [at(15, 0, 60)],
      plans: planes([NICO], [NICO]),
      workingRangesByStaff: { [NICO]: shift(9, 16) },
      appointmentsByStaff: { [NICO]: [] },
    });

    expect(slots).toEqual([]);
  });

  it('saltea el plan que tiene un tramo sin nadie habilitado', () => {
    const slots = buildBookingSlotsForPlans({
      candidateSlots: [at(15, 0, 60)],
      plans: [
        {
          segments: [
            {
              staffIds: [],
              offsetMinutes: 0,
              durationMinutes: 60,
              roundIndex: 0,
            },
          ],
        },
        {
          segments: [
            {
              staffIds: [NICO],
              offsetMinutes: 0,
              durationMinutes: 60,
              roundIndex: 0,
            },
          ],
        },
      ],
      workingRangesByStaff: allDay(NICO),
      appointmentsByStaff: { [NICO]: [] },
    });

    expect(slots).toHaveLength(1);
    // El índice es el de la lista original: compactarla lo haría apuntar a otro.
    expect(slots[0].planIndex).toBe(1);
  });
});
