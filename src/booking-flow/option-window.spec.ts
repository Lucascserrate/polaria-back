import { computeOptionWindow } from './option-window';

/** Lista nativa de WhatsApp: 10 filas, una reservada para "Cancelar". */
const NATIVE = { maxOptionsPerPrompt: 10, reservedOptions: 1 };

describe('computeOptionWindow', () => {
  it('sin tope de canal devuelve todo en una página', () => {
    expect(computeOptionWindow({ total: 200, offset: 0 })).toEqual({
      start: 0,
      end: 200,
      hasMore: false,
    });
  });

  it('con 9 opciones o menos no pagina', () => {
    expect(computeOptionWindow({ total: 9, offset: 0, ...NATIVE })).toEqual({
      start: 0,
      end: 9,
      hasMore: false,
    });
  });

  it('con 10 opciones muestra 8 y ofrece ver más', () => {
    // 8 opciones + "Ver más" + "Cancelar" = las 10 filas de WhatsApp.
    expect(computeOptionWindow({ total: 10, offset: 0, ...NATIVE })).toEqual({
      start: 0,
      end: 8,
      hasMore: true,
    });
  });

  it('la última página deja de ofrecer ver más', () => {
    expect(computeOptionWindow({ total: 10, offset: 8, ...NATIVE })).toEqual({
      start: 8,
      end: 10,
      hasMore: false,
    });
  });

  it('pagina una lista larga hasta el final', () => {
    const total = 20;
    const pages: Array<{ start: number; end: number }> = [];

    let offset = 0;
    for (let guard = 0; guard < 10; guard += 1) {
      const window = computeOptionWindow({ total, offset, ...NATIVE });
      pages.push({ start: window.start, end: window.end });
      if (!window.hasMore) break;
      offset = window.end;
    }

    expect(pages).toEqual([
      { start: 0, end: 8 },
      { start: 8, end: 16 },
      { start: 16, end: 20 },
    ]);
  });

  it('cubre todas las opciones sin huecos ni repeticiones', () => {
    const total = 37;
    const seen: number[] = [];

    let offset = 0;
    for (let guard = 0; guard < 20; guard += 1) {
      const window = computeOptionWindow({ total, offset, ...NATIVE });
      for (let i = window.start; i < window.end; i += 1) seen.push(i);
      if (!window.hasMore) break;
      offset = window.end;
    }

    expect(seen).toEqual(Array.from({ length: total }, (_, i) => i));
  });

  it('vuelve al principio si el offset quedó fuera de rango', () => {
    // La lista se recalculó y encogió: mostrar una página vacía sería peor.
    expect(computeOptionWindow({ total: 3, offset: 40, ...NATIVE })).toEqual({
      start: 0,
      end: 3,
      hasMore: false,
    });
  });

  it('devuelve una ventana vacía sin opciones', () => {
    expect(computeOptionWindow({ total: 0, offset: 0, ...NATIVE })).toEqual({
      start: 0,
      end: 0,
      hasMore: false,
    });
  });

  it('con un tope de 3 botones y una reserva muestra 1 y ofrece ver más', () => {
    expect(
      computeOptionWindow({
        total: 5,
        offset: 0,
        maxOptionsPerPrompt: 3,
        reservedOptions: 1,
      }),
    ).toEqual({ start: 0, end: 1, hasMore: true });
  });

  it('nunca produce una página vacía aunque la reserva agote el tope', () => {
    const window = computeOptionWindow({
      total: 5,
      offset: 0,
      maxOptionsPerPrompt: 1,
      reservedOptions: 1,
    });

    expect(window.end).toBeGreaterThan(window.start);
  });
});
