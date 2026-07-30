import {
  classifyInteraction,
  isIsoDate,
  isIsoInstant,
  isValueValidForState,
  nextStateAfter,
  readStaffSelection,
  type BookingSessionSnapshot,
} from './booking-flow.machine';
import {
  BookingSessionState,
  RESERVED_VALUES,
  StaffPreference,
} from './booking-flow.types';
import { encodeSelection } from './booking-payload.codec';

const TOKEN = 'a1b2c3d4e5f60718';
const NOW = new Date('2026-07-30T12:00:00.000Z');
const LATER = new Date('2026-07-30T12:10:00.000Z');

function session(
  overrides: Partial<BookingSessionSnapshot> = {},
): BookingSessionSnapshot {
  return {
    token: TOKEN,
    state: BookingSessionState.ASK_SERVICE,
    stepVersion: 4,
    expiresAt: new Date('2026-07-30T12:15:00.000Z'),
    lastMetaMessageId: null,
    ...overrides,
  };
}

function payload(
  overrides: {
    token?: string;
    stepVersion?: number;
    state?: BookingSessionState;
    value?: string;
  } = {},
): string {
  return encodeSelection({
    token: overrides.token ?? TOKEN,
    stepVersion: overrides.stepVersion ?? 4,
    state: overrides.state ?? BookingSessionState.ASK_SERVICE,
    value: overrides.value ?? 'service-uuid',
  });
}

describe('classifyInteraction', () => {
  it('acepta la respuesta del paso y la versión vigentes', () => {
    const verdict = classifyInteraction({
      session: session(),
      rawSelectionId: payload(),
      metaMessageId: 'wamid.NEW',
      now: NOW,
    });

    expect(verdict).toEqual({ kind: 'ACCEPT', value: 'service-uuid' });
  });

  it('descarta la reentrega del mismo webhook antes que cualquier otra cosa', () => {
    const verdict = classifyInteraction({
      session: session({ lastMetaMessageId: 'wamid.SAME' }),
      rawSelectionId: payload(),
      metaMessageId: 'wamid.SAME',
      now: NOW,
    });

    expect(verdict).toEqual({ kind: 'DUPLICATE' });
  });

  it('descarta como obsoleto el segundo toque del mismo botón', () => {
    // El primer toque llevó la sesión de la versión 4 a la 5.
    const verdict = classifyInteraction({
      session: session({ stepVersion: 5 }),
      rawSelectionId: payload({ stepVersion: 4 }),
      metaMessageId: 'wamid.SECOND_TAP',
      now: NOW,
    });

    expect(verdict).toEqual({ kind: 'STALE' });
  });

  it('descarta una respuesta que pertenece a otro paso', () => {
    const verdict = classifyInteraction({
      session: session({ state: BookingSessionState.ASK_SLOT }),
      rawSelectionId: payload({ state: BookingSessionState.ASK_SERVICE }),
      now: NOW,
    });

    expect(verdict).toEqual({ kind: 'STALE' });
  });

  it('marca como ajena una respuesta con token de otra sesión', () => {
    const verdict = classifyInteraction({
      session: session(),
      rawSelectionId: payload({ token: 'ffffffffffffffff' }),
      now: NOW,
    });

    expect(verdict).toEqual({ kind: 'FOREIGN' });
  });

  it('detecta la sesión vencida antes de evaluar el paso', () => {
    const verdict = classifyInteraction({
      session: session({ expiresAt: NOW }),
      rawSelectionId: payload(),
      now: LATER,
    });

    expect(verdict).toEqual({ kind: 'EXPIRED' });
  });

  it('honra la cancelación aunque el botón sea de una versión vieja', () => {
    const verdict = classifyInteraction({
      session: session({ stepVersion: 9 }),
      rawSelectionId: payload({
        stepVersion: 2,
        value: RESERVED_VALUES.CANCEL,
      }),
      now: NOW,
    });

    expect(verdict).toEqual({ kind: 'CANCEL' });
  });

  it('honra la cancelación aunque la sesión ya haya vencido', () => {
    const verdict = classifyInteraction({
      session: session({ expiresAt: NOW }),
      rawSelectionId: payload({ value: RESERVED_VALUES.CANCEL }),
      now: LATER,
    });

    expect(verdict).toEqual({ kind: 'CANCEL' });
  });

  it('no cancela una sesión ya terminada', () => {
    const verdict = classifyInteraction({
      session: session({ state: BookingSessionState.COMPLETED }),
      rawSelectionId: payload({ value: RESERVED_VALUES.CANCEL }),
      now: NOW,
    });

    expect(verdict).toEqual({ kind: 'STALE' });
  });

  it('descarta cualquier interacción sobre una sesión terminada', () => {
    for (const state of [
      BookingSessionState.COMPLETED,
      BookingSessionState.CANCELLED,
      BookingSessionState.EXPIRED,
    ]) {
      const verdict = classifyInteraction({
        session: session({ state }),
        rawSelectionId: payload({ state }),
        now: NOW,
      });

      expect(verdict.kind).toBe('STALE');
    }
  });

  it('marca como malformado un id que no generamos nosotros', () => {
    const verdict = classifyInteraction({
      session: session(),
      rawSelectionId: 'boton-de-otra-integracion',
      now: NOW,
    });

    expect(verdict).toEqual({ kind: 'MALFORMED' });
  });

  it('marca como malformado un valor imposible para el paso', () => {
    const verdict = classifyInteraction({
      session: session({ state: BookingSessionState.ASK_SLOT }),
      rawSelectionId: payload({
        state: BookingSessionState.ASK_SLOT,
        value: 'mañana temprano',
      }),
      now: NOW,
    });

    expect(verdict).toEqual({ kind: 'MALFORMED' });
  });
});

describe('isValueValidForState', () => {
  it('ASK_WHEN solo admite hoy u otro día', () => {
    expect(
      isValueValidForState(BookingSessionState.ASK_WHEN, RESERVED_VALUES.TODAY),
    ).toBe(true);
    expect(
      isValueValidForState(
        BookingSessionState.ASK_WHEN,
        RESERVED_VALUES.OTHER_DAY,
      ),
    ).toBe(true);
    expect(
      isValueValidForState(BookingSessionState.ASK_WHEN, '2026-07-31'),
    ).toBe(false);
  });

  it('ASK_DATE exige una fecha calendaria válida', () => {
    expect(
      isValueValidForState(BookingSessionState.ASK_DATE, '2026-07-31'),
    ).toBe(true);
    expect(
      isValueValidForState(BookingSessionState.ASK_DATE, '2026-02-30'),
    ).toBe(false);
    expect(isValueValidForState(BookingSessionState.ASK_DATE, 'viernes')).toBe(
      false,
    );
  });

  it('ASK_SLOT exige un instante ISO', () => {
    expect(
      isValueValidForState(
        BookingSessionState.ASK_SLOT,
        '2026-07-31T15:00:00.000Z',
      ),
    ).toBe(true);
    expect(isValueValidForState(BookingSessionState.ASK_SLOT, '15:00')).toBe(
      false,
    );
  });

  it('CONFIRM solo admite el valor de confirmación', () => {
    expect(
      isValueValidForState(
        BookingSessionState.CONFIRM,
        RESERVED_VALUES.CONFIRM,
      ),
    ).toBe(true);
    expect(isValueValidForState(BookingSessionState.CONFIRM, 'si')).toBe(false);
  });

  it('los estados terminales no admiten ningún valor', () => {
    expect(
      isValueValidForState(BookingSessionState.COMPLETED, 'cualquiera'),
    ).toBe(false);
  });
});

describe('nextStateAfter', () => {
  it('"Hoy" salta el selector de fecha', () => {
    expect(nextStateAfter(BookingSessionState.ASK_WHEN)).toBe(
      BookingSessionState.ASK_SERVICE,
    );
  });

  it('"Otro día" pasa por el selector de fecha', () => {
    expect(
      nextStateAfter(BookingSessionState.ASK_WHEN, { chosenOtherDay: true }),
    ).toBe(BookingSessionState.ASK_DATE);
  });

  it('omite el paso de profesional cuando hay uno solo', () => {
    expect(
      nextStateAfter(BookingSessionState.ASK_SERVICE, { skipStaffStep: true }),
    ).toBe(BookingSessionState.ASK_SLOT);
  });

  it('recorre el camino completo', () => {
    expect(nextStateAfter(BookingSessionState.ASK_DATE)).toBe(
      BookingSessionState.ASK_SERVICE,
    );
    expect(nextStateAfter(BookingSessionState.ASK_SERVICE)).toBe(
      BookingSessionState.ASK_STAFF,
    );
    expect(nextStateAfter(BookingSessionState.ASK_STAFF)).toBe(
      BookingSessionState.ASK_SLOT,
    );
    expect(nextStateAfter(BookingSessionState.ASK_SLOT)).toBe(
      BookingSessionState.CONFIRM,
    );
    expect(nextStateAfter(BookingSessionState.CONFIRM)).toBe(
      BookingSessionState.COMPLETED,
    );
  });

  it('un estado terminal no avanza', () => {
    expect(nextStateAfter(BookingSessionState.COMPLETED)).toBe(
      BookingSessionState.COMPLETED,
    );
  });
});

describe('readStaffSelection', () => {
  it('distingue "Sin preferencia" de un profesional concreto', () => {
    expect(readStaffSelection(RESERVED_VALUES.ANY_STAFF)).toEqual({
      staffPreference: StaffPreference.ANY,
      staffId: null,
    });

    expect(readStaffSelection('staff-uuid')).toEqual({
      staffPreference: StaffPreference.SPECIFIC,
      staffId: 'staff-uuid',
    });
  });
});

describe('validadores de formato', () => {
  it('isIsoDate rechaza fechas inexistentes', () => {
    expect(isIsoDate('2026-07-31')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-7-31')).toBe(false);
  });

  it('isIsoInstant exige sufijo Z', () => {
    expect(isIsoInstant('2026-07-31T15:00:00.000Z')).toBe(true);
    expect(isIsoInstant('2026-07-31T15:00:00Z')).toBe(true);
    expect(isIsoInstant('2026-07-31T15:00:00-03:00')).toBe(false);
  });
});
