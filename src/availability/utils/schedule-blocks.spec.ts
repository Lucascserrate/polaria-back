import { groupBlocksByStaff, type StaffBlockRow } from './schedule-blocks';

const at = (time: string): Date => new Date(`2026-03-16T${time}:00.000Z`);

const block = (
  staffId: string | null,
  startTime: string,
  endTime: string,
): StaffBlockRow => ({
  staffId,
  startTime: at(startTime),
  endTime: at(endTime),
});

/** Las franjas de alguien, como pares de horas, para poder compararlas. */
const hoursOf = (
  grouped: Record<string, { startTime: Date; endTime: Date }[]>,
  staffId: string,
): string[][] =>
  grouped[staffId].map((range) => [
    range.startTime.toISOString(),
    range.endTime.toISOString(),
  ]);

const expected = (...pairs: [string, string][]): string[][] =>
  pairs.map(([start, end]) => [at(start).toISOString(), at(end).toISOString()]);

describe('groupBlocksByStaff', () => {
  it('le da una entrada a cada profesional pedido, aunque no tenga bloqueos', () => {
    const grouped = groupBlocksByStaff([], ['lucas', 'fernando']);

    expect(grouped).toEqual({ lucas: [], fernando: [] });
  });

  it('deja el bloqueo de uno en su propia lista', () => {
    const grouped = groupBlocksByStaff(
      [block('lucas', '12:00', '13:00')],
      ['lucas', 'fernando'],
    );

    expect(hoursOf(grouped, 'lucas')).toEqual(expected(['12:00', '13:00']));
    expect(grouped.fernando).toEqual([]);
  });

  /* La regla entera de la tabla: un hueco sin dueño es de todos. */
  it('reparte el bloqueo sin profesional en la lista de todos', () => {
    const grouped = groupBlocksByStaff(
      [block(null, '15:00', '17:00')],
      ['lucas', 'fernando'],
    );

    expect(hoursOf(grouped, 'lucas')).toEqual(expected(['15:00', '17:00']));
    expect(hoursOf(grouped, 'fernando')).toEqual(expected(['15:00', '17:00']));
  });

  it('suma el del negocio al propio', () => {
    const grouped = groupBlocksByStaff(
      [block('lucas', '12:00', '13:00'), block(null, '15:00', '17:00')],
      ['lucas', 'fernando'],
    );

    expect(hoursOf(grouped, 'lucas')).toEqual(
      expected(['12:00', '13:00'], ['15:00', '17:00']),
    );
    expect(hoursOf(grouped, 'fernando')).toEqual(expected(['15:00', '17:00']));
  });

  /*
   * Pasa al filtrar por servicio: el bloqueo es de alguien del negocio, pero esa
   * persona no hace el servicio consultado y no vino en la lista.
   */
  it('descarta el bloqueo de alguien que no está en la lista', () => {
    const grouped = groupBlocksByStaff(
      [block('ajeno', '12:00', '13:00')],
      ['lucas'],
    );

    expect(grouped).toEqual({ lucas: [] });
  });

  it('sin profesionales no devuelve nada', () => {
    expect(groupBlocksByStaff([block(null, '12:00', '13:00')], [])).toEqual({});
  });

  it('no duplica al profesional repetido en la lista', () => {
    const grouped = groupBlocksByStaff(
      [block(null, '12:00', '13:00')],
      ['lucas', 'lucas'],
    );

    expect(hoursOf(grouped, 'lucas')).toEqual(expected(['12:00', '13:00']));
  });
});
