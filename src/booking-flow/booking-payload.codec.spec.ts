import { BookingSessionState } from './booking-flow.types';
import {
  BookingPayloadError,
  decodeSelection,
  encodeSelection,
} from './booking-payload.codec';

const TOKEN = 'a1b2c3d4e5f60718';

describe('encodeSelection', () => {
  it('codifica protocolo, token, versión, estado y valor', () => {
    const encoded = encodeSelection({
      token: TOKEN,
      stepVersion: 3,
      state: BookingSessionState.ASK_SERVICE,
      value: 'service-uuid',
    });

    expect(encoded).toBe(`b1|${TOKEN}|3|ASK_SERVICE|service-uuid`);
  });

  it('rechaza valores que contienen el separador', () => {
    expect(() =>
      encodeSelection({
        token: TOKEN,
        stepVersion: 1,
        state: BookingSessionState.ASK_SERVICE,
        value: 'a|b',
      }),
    ).toThrow(BookingPayloadError);
  });

  it('rechaza token vacío', () => {
    expect(() =>
      encodeSelection({
        token: '',
        stepVersion: 1,
        state: BookingSessionState.ASK_SERVICE,
        value: 'today',
      }),
    ).toThrow(BookingPayloadError);
  });

  it('rechaza versiones no enteras o negativas', () => {
    for (const stepVersion of [-1, 1.5, Number.NaN]) {
      expect(() =>
        encodeSelection({
          token: TOKEN,
          stepVersion,
          state: BookingSessionState.ASK_SERVICE,
          value: 'today',
        }),
      ).toThrow(BookingPayloadError);
    }
  });

  it('rechaza identificadores que superan el límite de una fila de lista', () => {
    expect(() =>
      encodeSelection({
        token: TOKEN,
        stepVersion: 1,
        state: BookingSessionState.ASK_SERVICE,
        value: 'x'.repeat(200),
      }),
    ).toThrow(/límite es 200/);
  });

  it('un instante ISO entra sin problema en el límite', () => {
    const encoded = encodeSelection({
      token: TOKEN,
      stepVersion: 12,
      state: BookingSessionState.ASK_SLOT,
      value: '2026-07-31T15:00:00.000Z',
    });

    expect(encoded.length).toBeLessThanOrEqual(200);
  });
});

describe('decodeSelection', () => {
  it('hace ida y vuelta sin pérdida', () => {
    const original = {
      token: TOKEN,
      stepVersion: 7,
      state: BookingSessionState.ASK_SLOT,
      value: '2026-07-31T15:00:00.000Z',
    };

    expect(decodeSelection(encodeSelection(original))).toEqual(original);
  });

  it('rechaza otro protocolo', () => {
    expect(decodeSelection(`b2|${TOKEN}|1|ASK_SERVICE|uuid`)).toBeNull();
  });

  it('rechaza un estado inexistente', () => {
    expect(decodeSelection(`b1|${TOKEN}|1|ASK_COLOR|rojo`)).toBeNull();
  });

  it('rechaza una versión no numérica', () => {
    expect(decodeSelection(`b1|${TOKEN}|abc|ASK_SERVICE|uuid`)).toBeNull();
  });

  it('rechaza cantidades de campos distintas a cinco', () => {
    expect(decodeSelection(`b1|${TOKEN}|1|ASK_SERVICE`)).toBeNull();
    expect(decodeSelection(`b1|${TOKEN}|1|ASK_SERVICE|uuid|extra`)).toBeNull();
  });

  it('rechaza token o valor vacíos', () => {
    expect(decodeSelection('b1||1|ASK_SERVICE|uuid')).toBeNull();
    expect(decodeSelection(`b1|${TOKEN}|1|ASK_SERVICE|`)).toBeNull();
  });

  it('rechaza entradas que no son payloads nuestros', () => {
    expect(decodeSelection('')).toBeNull();
    expect(decodeSelection('hola')).toBeNull();
    expect(decodeSelection('some-random-button-id')).toBeNull();
  });
});
