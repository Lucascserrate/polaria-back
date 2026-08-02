import { hasOptions, type BookingPrompt } from './booking-flow.types';

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
