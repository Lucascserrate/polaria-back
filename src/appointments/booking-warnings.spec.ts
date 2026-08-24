import {
  BookingWarningCode,
  collectBookingWarnings,
  type RequestedSegment,
} from './booking-warnings';

const NOW = new Date('2026-08-24T18:00:00.000Z'); // 14:00 en Bolivia (UTC-4)

/** Instante a partir de una hora local del 24 de agosto en Bolivia. */
const at = (time: string): Date => {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(Date.UTC(2026, 7, 24, hours + 4, minutes));
};

/** El negocio abre de 09:00 a 19:00. */
const BUSINESS = [{ startTime: at('09:00'), endTime: at('19:00') }];

const segment = (
  start: string,
  end: string,
  staffId = 'diego',
  staffName: string | null = 'Diego',
): RequestedSegment => ({
  staffId,
  staffName,
  startTime: at(start),
  endTime: at(end),
});

const collect = (input: {
  segments: RequestedSegment[];
  businessRanges?: Array<{ startTime: Date; endTime: Date }>;
  workingRangesByStaff?: Record<
    string,
    Array<{ startTime: Date; endTime: Date }>
  >;
  busyByStaff?: Record<string, Array<{ startTime: Date; endTime: Date }>>;
  now?: Date;
}) =>
  collectBookingWarnings({
    now: input.now ?? NOW,
    segments: input.segments,
    businessRanges: input.businessRanges ?? BUSINESS,
    workingRangesByStaff: input.workingRangesByStaff ?? {
      diego: BUSINESS,
      carlos: BUSINESS,
    },
    busyByStaff: input.busyByStaff,
  }).map((warning) => warning.code);

describe('collectBookingWarnings', () => {
  it('no advierte nada de una reserva normal', () => {
    // Dentro del horario, con el profesional de turno y en el futuro.
    expect(collect({ segments: [segment('16:00', '16:30')] })).toEqual([]);
  });

  it('advierte que la hora ya pasó, sin impedirla', () => {
    // Son las 14:00: registrar las 10:00 de hoy es cargar algo que ya ocurrió.
    expect(collect({ segments: [segment('10:00', '10:30')] })).toEqual([
      BookingWarningCode.PAST_TIME,
    ]);
  });

  it('el borde exacto de ahora no es pasado', () => {
    expect(collect({ segments: [segment('14:00', '14:30')] })).toEqual([]);
  });

  it('advierte el día cerrado y no repite lo que es consecuencia', () => {
    // Con el local cerrado nadie está de turno y ninguna hora está en horario:
    // decir las tres cosas no informa más que decir la que explica.
    expect(
      collect({
        segments: [segment('16:00', '16:30')],
        businessRanges: [],
        workingRangesByStaff: { diego: [] },
      }),
    ).toEqual([BookingWarningCode.CLOSED_DAY]);
  });

  it('un día cerrado en el pasado advierte las dos cosas', () => {
    expect(
      collect({
        segments: [segment('10:00', '10:30')],
        businessRanges: [],
        workingRangesByStaff: { diego: [] },
      }),
    ).toEqual([BookingWarningCode.PAST_TIME, BookingWarningCode.CLOSED_DAY]);
  });

  it('advierte fuera del horario de atención', () => {
    // El negocio cierra a las 19:00.
    expect(collect({ segments: [segment('20:00', '20:30')] })).toEqual([
      BookingWarningCode.OUTSIDE_BUSINESS_HOURS,
    ]);
  });

  it('advierte cuando la cita empieza dentro del horario y termina afuera', () => {
    // 18:45 a 19:15: el cierre parte la cita al medio.
    expect(collect({ segments: [segment('18:45', '19:15')] })).toEqual([
      BookingWarningCode.OUTSIDE_BUSINESS_HOURS,
    ]);
  });

  it('no dice también "fuera de turno" cuando el negocio no abre a esa hora', () => {
    expect(
      collect({
        segments: [segment('20:00', '20:30')],
        workingRangesByStaff: { diego: [] },
      }),
    ).toEqual([BookingWarningCode.OUTSIDE_BUSINESS_HOURS]);
  });

  it('advierte el profesional fuera de su jornada', () => {
    // El local abre hasta las 19:00 pero Diego trabaja hasta las 13:00.
    expect(
      collect({
        segments: [segment('16:00', '16:30')],
        workingRangesByStaff: {
          diego: [{ startTime: at('09:00'), endTime: at('13:00') }],
        },
      }),
    ).toEqual([BookingWarningCode.STAFF_OFF_SHIFT]);
  });

  it('nombra al profesional en el aviso', () => {
    const warnings = collectBookingWarnings({
      now: NOW,
      segments: [segment('16:00', '16:30')],
      businessRanges: BUSINESS,
      workingRangesByStaff: { diego: [] },
    });

    expect(warnings[0].message).toContain('Diego');
    expect(warnings[0].staffId).toBe('diego');
  });

  it('sobrevive a un profesional sin nombre', () => {
    const warnings = collectBookingWarnings({
      now: NOW,
      segments: [segment('16:00', '16:30', 'diego', null)],
      businessRanges: BUSINESS,
      workingRangesByStaff: { diego: [] },
    });

    expect(warnings[0].message).toContain('El profesional');
  });

  it('avisa una vez por profesional, no una por tramo', () => {
    // Dos servicios seguidos con la misma persona fuera de turno.
    expect(
      collect({
        segments: [segment('16:00', '16:30'), segment('16:30', '17:00')],
        workingRangesByStaff: { diego: [] },
      }),
    ).toEqual([BookingWarningCode.STAFF_OFF_SHIFT]);
  });

  it('avisa por cada profesional cuando son distintos', () => {
    const warnings = collectBookingWarnings({
      now: NOW,
      segments: [
        segment('16:00', '16:30', 'diego', 'Diego'),
        segment('16:30', '17:00', 'carlos', 'Carlos'),
      ],
      businessRanges: BUSINESS,
      workingRangesByStaff: { diego: [], carlos: [] },
    });

    expect(warnings.map((w) => w.staffId)).toEqual(['diego', 'carlos']);
  });

  it('solo advierte del que está fuera de turno', () => {
    const warnings = collectBookingWarnings({
      now: NOW,
      segments: [
        segment('16:00', '16:30', 'diego', 'Diego'),
        segment('16:30', '17:00', 'carlos', 'Carlos'),
      ],
      businessRanges: BUSINESS,
      workingRangesByStaff: { diego: BUSINESS, carlos: [] },
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].staffId).toBe('carlos');
  });

  it('un turno partido admite la cita en cualquiera de sus franjas', () => {
    const split = [
      { startTime: at('09:00'), endTime: at('13:00') },
      { startTime: at('15:00'), endTime: at('19:00') },
    ];

    expect(
      collect({
        segments: [segment('16:00', '16:30')],
        businessRanges: split,
        workingRangesByStaff: { diego: split },
      }),
    ).toEqual([]);
  });

  it('la pausa del turno partido queda fuera de horario', () => {
    // 14:30 está en la pausa y todavía no pasó: aísla la advertencia de horario.
    const split = [
      { startTime: at('09:00'), endTime: at('13:00') },
      { startTime: at('15:00'), endTime: at('19:00') },
    ];

    expect(
      collect({
        segments: [segment('14:30', '15:00')],
        businessRanges: split,
        workingRangesByStaff: { diego: split },
      }),
    ).toEqual([BookingWarningCode.OUTSIDE_BUSINESS_HOURS]);
  });

  it('sin tramos no hay nada que advertir', () => {
    expect(collect({ segments: [] })).toEqual([]);
  });
});

describe('collectBookingWarnings · pisarse con otra cita', () => {
  it('advierte cuando el tramo se pisa con una cita existente', () => {
    // El caso de alargar una reserva: 16:30 pasa a terminar 17:30 y se come
    // los 17:00 de otro cliente.
    expect(
      collect({
        segments: [segment('16:30', '17:30')],
        busyByStaff: {
          diego: [{ startTime: at('17:00'), endTime: at('17:30') }],
        },
      }),
    ).toEqual([BookingWarningCode.STAFF_BUSY]);
  });

  it('no advierte cuando una termina justo donde empieza la otra', () => {
    expect(
      collect({
        segments: [segment('16:00', '17:00')],
        busyByStaff: {
          diego: [{ startTime: at('17:00'), endTime: at('17:30') }],
        },
      }),
    ).toEqual([]);
  });

  it('no confunde la agenda de un profesional con la de otro', () => {
    expect(
      collect({
        segments: [segment('16:30', '17:30')],
        busyByStaff: {
          carlos: [{ startTime: at('17:00'), endTime: at('17:30') }],
        },
      }),
    ).toEqual([]);
  });

  it('lo dice una sola vez aunque se pisen varios tramos del mismo profesional', () => {
    expect(
      collect({
        segments: [segment('16:00', '16:30'), segment('16:30', '17:00')],
        busyByStaff: {
          diego: [{ startTime: at('16:00'), endTime: at('17:00') }],
        },
      }),
    ).toEqual([BookingWarningCode.STAFF_BUSY]);
  });

  it('no se calla porque además esté fuera de horario', () => {
    // Es la advertencia que involucra a otra persona esperando: taparla con
    // "fuera de horario" sería esconder la más grave de las dos.
    expect(
      collect({
        segments: [segment('19:00', '20:00')],
        busyByStaff: {
          diego: [{ startTime: at('19:00'), endTime: at('19:30') }],
        },
      }),
    ).toEqual([
      BookingWarningCode.STAFF_BUSY,
      BookingWarningCode.OUTSIDE_BUSINESS_HOURS,
    ]);
  });

  it('no se calla porque además el día esté cerrado', () => {
    expect(
      collect({
        segments: [segment('16:30', '17:30')],
        businessRanges: [],
        busyByStaff: {
          diego: [{ startTime: at('17:00'), endTime: at('17:30') }],
        },
      }),
    ).toEqual([BookingWarningCode.STAFF_BUSY, BookingWarningCode.CLOSED_DAY]);
  });

  it('sin agenda ocupada no cambia nada', () => {
    expect(collect({ segments: [segment('16:00', '16:30')] })).toEqual([]);
  });
});
