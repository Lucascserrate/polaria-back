import {
  BookingSessionState,
  isTerminalState,
  RESERVED_VALUES,
  StaffPreference,
} from './booking-flow.types';
import {
  decodeSelection,
  type DecodedSelection,
} from './booking-payload.codec';

/**
 * Reglas puras del flujo guiado: qué interacciones se aceptan y qué paso sigue.
 *
 * Todo lo que decide esta capa es función de la sesión y del `selectionId`
 * recibido. No hay acceso a datos, ni reloj implícito, ni WhatsApp.
 */

/** Vista mínima de la sesión que necesitan las reglas. */
export type BookingSessionSnapshot = {
  token: string;
  state: BookingSessionState;
  stepVersion: number;
  expiresAt: Date;
  lastMetaMessageId?: string | null;
};

export type InteractionVerdict =
  /** Interacción válida para el paso actual. */
  | { kind: 'ACCEPT'; value: string }
  /** Cancelación explícita del cliente. */
  | { kind: 'CANCEL' }
  /** Reentrega del mismo webhook: ya fue procesada. */
  | { kind: 'DUPLICATE' }
  /** Pertenece a otro paso, otra versión o una sesión terminada. */
  | { kind: 'STALE' }
  /** La sesión venció por inactividad. */
  | { kind: 'EXPIRED' }
  /** El token no corresponde a esta sesión. */
  | { kind: 'FOREIGN' }
  /** El identificador no tiene la forma esperada. */
  | { kind: 'MALFORMED' };

export type ClassifyInteractionInput = {
  session: BookingSessionSnapshot;
  rawSelectionId: string;
  metaMessageId?: string | null;
  now: Date;
};

/**
 * Decide qué hacer con una respuesta interactiva.
 *
 * El orden de las comprobaciones importa:
 *
 * 1. **Duplicado antes que todo lo demás.** Meta reintenta los webhooks; si un
 *    reintento llegara después de haber avanzado el paso, se leería como una
 *    segunda interacción y podría duplicar una reserva.
 * 2. **Caducidad antes que la validez del paso**, para poder explicarle al
 *    cliente que la sesión venció en lugar de decirle que su toque fue inválido.
 * 3. **Cancelación por encima de la versión del paso.** Si el token es de esta
 *    sesión y el cliente pidió cancelar, la intención no es ambigua ni siquiera
 *    con un botón viejo: se honra. Es la única excepción a la regla de versión, y
 *    es segura porque cancelar no crea nada.
 */
export function classifyInteraction(
  input: ClassifyInteractionInput,
): InteractionVerdict {
  const { session, rawSelectionId, metaMessageId, now } = input;

  if (
    metaMessageId &&
    session.lastMetaMessageId &&
    metaMessageId === session.lastMetaMessageId
  ) {
    return { kind: 'DUPLICATE' };
  }

  const decoded = decodeSelection(rawSelectionId);
  if (!decoded) return { kind: 'MALFORMED' };

  if (decoded.token !== session.token) return { kind: 'FOREIGN' };

  if (decoded.value === RESERVED_VALUES.CANCEL) {
    if (isTerminalState(session.state)) return { kind: 'STALE' };
    return { kind: 'CANCEL' };
  }

  if (isExpired(session, now)) return { kind: 'EXPIRED' };

  if (isTerminalState(session.state)) return { kind: 'STALE' };

  if (decoded.stepVersion !== session.stepVersion) return { kind: 'STALE' };

  if (decoded.state !== session.state) return { kind: 'STALE' };

  if (!isValueValidForState(session.state, decoded.value)) {
    return { kind: 'MALFORMED' };
  }

  return { kind: 'ACCEPT', value: decoded.value };
}

export function isExpired(
  session: Pick<BookingSessionSnapshot, 'expiresAt'>,
  now: Date,
): boolean {
  return session.expiresAt.getTime() <= now.getTime();
}

/**
 * Valida que el valor recibido tenga la forma que ese paso puede producir.
 *
 * No comprueba existencia en base de datos (eso lo hace el orquestador), sino que
 * el valor no sea algo que ese componente jamás pudo haber generado.
 */
export function isValueValidForState(
  state: BookingSessionState,
  value: string,
): boolean {
  // "Ver más" es una respuesta legítima de cualquier paso paginado: no elige nada,
  // avanza la página.
  if (value === RESERVED_VALUES.MORE) return isPaginatedState(state);

  switch (state) {
    case BookingSessionState.ASK_DATE:
      return isIsoDate(value);

    case BookingSessionState.ASK_SERVICE:
      return value.length > 0;

    case BookingSessionState.ASK_STAFF:
      return value === RESERVED_VALUES.ANY_STAFF || value.length > 0;

    case BookingSessionState.ASK_SLOT:
      // "Ver otros días" es una respuesta legítima de este paso: no elige
      // horario, abre el selector de fecha.
      return value === RESERVED_VALUES.OTHER_DAYS || isIsoInstant(value);

    case BookingSessionState.CONFIRM:
      return value === RESERVED_VALUES.CONFIRM;

    default:
      return false;
  }
}

/** Pasos que se muestran como lista y por lo tanto pueden necesitar paginación. */
export function isPaginatedState(state: BookingSessionState): boolean {
  return (
    state === BookingSessionState.ASK_DATE ||
    state === BookingSessionState.ASK_SERVICE ||
    state === BookingSessionState.ASK_STAFF ||
    state === BookingSessionState.ASK_SLOT
  );
}

/**
 * Paso siguiente dentro del recorrido lineal.
 *
 * `skipStaffStep` viene del orquestador: si un solo profesional puede hacer el
 * servicio, el paso se omite y la preferencia queda registrada como específica.
 */
export function nextStateAfter(
  state: BookingSessionState,
  options: { skipStaffStep?: boolean } = {},
): BookingSessionState {
  switch (state) {
    // Elegir fecha vuelve a los horarios, no avanza: es un desvío que corrige la
    // fecha de la sesión y devuelve al paso donde estaba el cliente.
    case BookingSessionState.ASK_DATE:
      return BookingSessionState.ASK_SLOT;

    case BookingSessionState.ASK_SERVICE:
      return options.skipStaffStep
        ? BookingSessionState.ASK_SLOT
        : BookingSessionState.ASK_STAFF;

    case BookingSessionState.ASK_STAFF:
      return BookingSessionState.ASK_SLOT;

    case BookingSessionState.ASK_SLOT:
      return BookingSessionState.CONFIRM;

    case BookingSessionState.CONFIRM:
      return BookingSessionState.COMPLETED;

    default:
      return state;
  }
}

/** Traduce el valor del paso de profesional a la preferencia persistida. */
export function readStaffSelection(value: string): {
  staffPreference: StaffPreference;
  staffId: string | null;
} {
  if (value === RESERVED_VALUES.ANY_STAFF) {
    return { staffPreference: StaffPreference.ANY, staffId: null };
  }
  return { staffPreference: StaffPreference.SPECIFIC, staffId: value };
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isIsoInstant(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)) {
    return false;
  }
  return !Number.isNaN(new Date(value).getTime());
}

export type { DecodedSelection };
