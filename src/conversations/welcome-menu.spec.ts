import {
  buildWelcomeMenu,
  decodeMenuAction,
  encodeMenuAction,
  isMenuSelection,
  shouldSendWelcomeMenu,
  WELCOME_MENU_COOLDOWN_MINUTES,
  WELCOME_MENU_SOURCE,
  WelcomeMenuAction,
} from './welcome-menu';

const NOW = new Date('2026-08-02T12:00:00.000Z');

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

describe('shouldSendWelcomeMenu', () => {
  it('lo manda si nunca hubo saliente', () => {
    expect(shouldSendWelcomeMenu({ now: NOW })).toBe(true);
  });

  it('no lo repite si el último saliente fue un menú reciente', () => {
    // Tres mensajes seguidos sin intención detectada no deben producir tres
    // menús idénticos.
    expect(
      shouldSendWelcomeMenu({
        lastOutgoingSource: WELCOME_MENU_SOURCE,
        lastOutgoingAt: minutesAgo(1),
        now: NOW,
      }),
    ).toBe(false);
  });

  it('vuelve a mandarlo pasado el enfriamiento', () => {
    expect(
      shouldSendWelcomeMenu({
        lastOutgoingSource: WELCOME_MENU_SOURCE,
        lastOutgoingAt: minutesAgo(WELCOME_MENU_COOLDOWN_MINUTES + 1),
        now: NOW,
      }),
    ).toBe(true);
  });

  it('lo manda si el último saliente fue otra cosa', () => {
    // Después de un paso del flujo o del aviso de traspaso, el menú vuelve a
    // tener sentido.
    expect(
      shouldSendWelcomeMenu({
        lastOutgoingSource: 'booking-flow',
        lastOutgoingAt: minutesAgo(1),
        now: NOW,
      }),
    ).toBe(true);
  });
});

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
