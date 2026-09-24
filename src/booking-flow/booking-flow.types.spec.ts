import {
  decodeSlotRange,
  encodeSlotRange,
  hasOptions,
  SLOT_RANGE_PREFIX,
  type BookingPrompt,
} from './booking-flow.types';

const option = { selectionId: 'b1|tok|1|ASK_SERVICE|uuid', title: 'Corte' };

describe('hasOptions', () => {
  it('reconoce los pasos que ofrecen algo que tocar', () => {
    const prompts: BookingPrompt[] = [
      { kind: 'ASK_SERVICE', date: '2026-08-02', options: [option] },
      { kind: 'ASK_STAFF', options: [option] },
      { kind: 'ASK_DATE', options: [option] },
      {
        kind: 'ASK_SLOT',
        date: '2026-08-02',
        hasSlots: true,
        options: [option],
      },
    ];

    for (const prompt of prompts) {
      expect(hasOptions(prompt)).toBe(true);
    }
  });

  it('un día sin cupo sigue teniendo salida', () => {
    // Las opciones son "Ver otros días" y "Cancelar": no es un callejón.
    expect(
      hasOptions({
        kind: 'ASK_SLOT',
        date: '2026-08-02',
        hasSlots: false,
        options: [option],
      }),
    ).toBe(true);
  });

  it('detecta los prompts sin salida', () => {
    // Este es el caso que dejaba la conversación congelada y sin botones: sesión
    // abierta, texto libre sin interpretar y ni "Cancelar" para tocar.
    expect(hasOptions({ kind: 'NO_AVAILABILITY', scope: 'SETUP' })).toBe(false);
    expect(hasOptions({ kind: 'STALE' })).toBe(false);
    expect(hasOptions({ kind: 'NONE' })).toBe(false);
  });

  it('una lista vacía no cuenta como salida', () => {
    expect(hasOptions({ kind: 'ASK_STAFF', options: [] })).toBe(false);
  });
});

/**
 * Cómo viaja un tramo del día en el mismo paso que los horarios sueltos.
 *
 * Los dos van por `ASK_SLOT` y hay que poder distinguirlos sin ambigüedad: un
 * horario es un instante, un tramo son dos.
 */
describe('tramos del día', () => {
  const from = new Date('2026-09-24T17:00:00.000Z');
  const to = new Date('2026-09-24T19:30:00.000Z');

  it('va y vuelve sin perder nada', () => {
    expect(decodeSlotRange(encodeSlotRange(from, to))).toEqual({ from, to });
  });

  it('no usa el separador del payload', () => {
    // `|` parte el `selectionId`; un tramo que lo llevara rompería el decodificado.
    expect(encodeSlotRange(from, to)).not.toContain('|');
  });

  it('un horario suelto no se confunde con un tramo', () => {
    expect(decodeSlotRange(from.toISOString())).toBeNull();
  });

  it('un valor reservado tampoco', () => {
    expect(decodeSlotRange('otherdays')).toBeNull();
  });

  /*
   * Devolver `null` en lugar de lanzar es lo que permite preguntarlo primero y
   * tratar al resto como un horario, que es el caso de siempre.
   */
  it('con un tramo ilegible devuelve null en vez de romper', () => {
    expect(decodeSlotRange(`${SLOT_RANGE_PREFIX}no~es~fecha`)).toBeNull();
    expect(decodeSlotRange(SLOT_RANGE_PREFIX)).toBeNull();
  });
});
