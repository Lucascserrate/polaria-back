import {
  buildWelcomeMenu,
  decodeMenuAction,
  encodeMenuAction,
  isMenuSelection,
  WelcomeMenuAction,
} from './welcome-menu';

describe('codificación de acciones del menú', () => {
  it('hace ida y vuelta', () => {
    for (const action of Object.values(WelcomeMenuAction)) {
      expect(decodeMenuAction(encodeMenuAction(action))).toBe(action);
    }
  });

  it('no se confunde con un payload de reserva', () => {
    // El coordinador distingue los dos transportes por el prefijo, así que esto
    // no puede solaparse nunca.
    const bookingPayload = 'b1|a1b2c3|3|ASK_SERVICE|uuid';

    expect(isMenuSelection(bookingPayload)).toBe(false);
    expect(decodeMenuAction(bookingPayload)).toBeNull();
    expect(isMenuSelection(encodeMenuAction(WelcomeMenuAction.BOOK))).toBe(
      true,
    );
  });

  it('rechaza acciones desconocidas y versiones ajenas', () => {
    expect(decodeMenuAction('menu|v1|borrar')).toBeNull();
    expect(decodeMenuAction('menu|v2|book')).toBeNull();
    expect(decodeMenuAction('otro|v1|book')).toBeNull();
    expect(decodeMenuAction('menu|v1')).toBeNull();
    expect(decodeMenuAction('')).toBeNull();
  });
});

describe('buildWelcomeMenu', () => {
  it('nombra al negocio y ofrece las dos salidas', () => {
    const menu = buildWelcomeMenu('Barbería Polaria');

    expect(menu.body).toContain('Barbería Polaria');
    expect(menu.options.map((option) => option.id)).toEqual([
      encodeMenuAction(WelcomeMenuAction.BOOK),
      encodeMenuAction(WelcomeMenuAction.TALK_TO_HUMAN),
    ]);
  });

  it('los títulos entran en el límite de un botón de WhatsApp', () => {
    for (const option of buildWelcomeMenu('Barbería Polaria').options) {
      expect(option.title.length).toBeLessThanOrEqual(20);
    }
  });

  it('cabe en el máximo de tres botones', () => {
    expect(buildWelcomeMenu('X').options.length).toBeLessThanOrEqual(3);
  });
});
