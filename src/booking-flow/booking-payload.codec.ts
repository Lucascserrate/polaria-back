import { BookingSessionState } from './booking-flow.types';

/**
 * Codificación de los identificadores que viajan en listas y botones.
 *
 * Formato: `b1|<token>|<stepVersion>|<state>|<value>`
 *
 * - `b1` versiona el protocolo, para poder cambiar el formato más adelante sin
 *   confundir un payload nuevo con uno viejo.
 * - `token` ata la respuesta a una sesión concreta.
 * - `stepVersion` ata la respuesta al paso concreto que la generó.
 * - `state` indica a qué componente pertenece.
 * - `value` es el dato: un uuid, una fecha, un instante ISO o un valor reservado.
 *
 * Todo lo que el backend necesita para decidir viaja acá, y todo fue generado por
 * el backend. Nada se interpreta.
 */

const PROTOCOL = 'b1';
const SEPARATOR = '|';

/** Límite de `id` de fila en una lista nativa; el más restrictivo de los dos. */
const MAX_ENCODED_LENGTH = 200;

export type DecodedSelection = {
  token: string;
  stepVersion: number;
  state: BookingSessionState;
  value: string;
};

export class BookingPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookingPayloadError';
  }
}

export function encodeSelection(params: {
  token: string;
  stepVersion: number;
  state: BookingSessionState;
  value: string;
}): string {
  const { token, stepVersion, state, value } = params;

  for (const [label, part] of [
    ['token', token],
    ['value', value],
  ] as const) {
    if (part.length === 0) {
      throw new BookingPayloadError(
        `El campo "${label}" no puede estar vacío.`,
      );
    }
    if (part.includes(SEPARATOR)) {
      throw new BookingPayloadError(
        `El campo "${label}" no puede contener "${SEPARATOR}".`,
      );
    }
  }

  if (!Number.isInteger(stepVersion) || stepVersion < 0) {
    throw new BookingPayloadError(
      `stepVersion debe ser un entero no negativo y se recibió ${stepVersion}.`,
    );
  }

  const encoded = [PROTOCOL, token, String(stepVersion), state, value].join(
    SEPARATOR,
  );

  if (encoded.length > MAX_ENCODED_LENGTH) {
    throw new BookingPayloadError(
      `El identificador codificado mide ${encoded.length} caracteres y el límite es ${MAX_ENCODED_LENGTH}.`,
    );
  }

  return encoded;
}

/**
 * Decodifica un `selectionId`. Devuelve `null` ante cualquier anomalía: no es
 * tarea de esta función explicar el problema, sino garantizar que lo que sale es
 * estructuralmente válido.
 */
export function decodeSelection(raw: string): DecodedSelection | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  const parts = raw.split(SEPARATOR);
  if (parts.length !== 5) return null;

  const [protocol, token, rawStepVersion, rawState, value] = parts;

  if (protocol !== PROTOCOL) return null;
  if (token.length === 0 || value.length === 0) return null;

  if (!/^\d+$/.test(rawStepVersion)) return null;
  const stepVersion = Number(rawStepVersion);
  if (!Number.isSafeInteger(stepVersion)) return null;

  if (!isBookingSessionState(rawState)) return null;

  return { token, stepVersion, state: rawState, value };
}

function isBookingSessionState(value: string): value is BookingSessionState {
  return (Object.values(BookingSessionState) as string[]).includes(value);
}
