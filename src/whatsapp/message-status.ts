import {
  asObject,
  getArrayField,
  getObjectField,
  getStringField,
  type JsonObject,
} from '../webhook/webhook-meta.util';

/**
 * Los avisos de Meta sobre qué pasó con un mensaje que **nosotros** enviamos.
 *
 * Llegan por el mismo webhook y el mismo `field: "messages"` que los mensajes
 * entrantes, pero en `value.statuses` en lugar de `value.messages`. Por eso pasaban
 * inadvertidos: el parser de entrantes devuelve `null` cuando no hay `messages`, y
 * el llamador cortaba en silencio.
 *
 * Distinguen tres cosas que es fácil confundir y que acá se separan a propósito:
 *
 * - **Graph aceptó** el pedido y asignó un `wamid`. Es lo que informa
 *   `WhatsAppSenderService` con su `send OK`, y **no** significa que el mensaje
 *   salió.
 * - **`sent`**: Meta lo despachó hacia el teléfono.
 * - **`delivered`**: llegó al dispositivo. Recién acá el mensaje existe para quien
 *   lo recibe.
 * - **`failed`**: no va a llegar, y `errors[]` dice por qué.
 *
 * Todo lo de este archivo es puro.
 */

export interface MessageStatusError {
  code: number | null;
  title: string | null;
  /** El texto más específico que da Meta. Suele estar en `error_data.details`. */
  detail: string | null;
}

export interface MessageStatusEvent {
  /** El `wamid` que devolvió el envío. Es lo que permite emparejarlos. */
  metaMessageId: string | null;
  /** `sent`, `delivered`, `read`, `failed`, y lo que Meta agregue. */
  status: string | null;
  /** El número al que iba, en el formato de Meta (sin `+`). */
  recipientId: string | null;
  /** Segundos desde epoch, como los manda Meta. */
  timestamp: string | null;
  /** Presentes cuando `status` es `failed`. */
  errors: MessageStatusError[];
}

/**
 * Los estados que trae un `change` del webhook, si trae alguno.
 *
 * Devuelve un array vacío cuando el evento no es de estados, que es el caso
 * frecuente: la mayoría de los webhooks son mensajes entrantes.
 */
export function parseMessageStatuses(change: JsonObject): MessageStatusEvent[] {
  const value = getObjectField(change, 'value');
  if (!value) return [];

  const statuses = getArrayField(value, 'statuses') ?? [];

  return statuses
    .map((raw) => asObject(raw))
    .filter((entry): entry is JsonObject => entry !== null)
    .map((entry) => ({
      metaMessageId: getStringField(entry, 'id'),
      status: getStringField(entry, 'status'),
      recipientId: getStringField(entry, 'recipient_id'),
      timestamp: getStringField(entry, 'timestamp'),
      errors: parseErrors(entry),
    }));
}

/**
 * El detalle del fallo, cuando lo hay.
 *
 * Se leen los tres niveles porque Meta no es consistente en cuál llena: el `code`
 * siempre está, `title` es genérico, y `error_data.details` es el que dice la razón
 * concreta —por ejemplo, que el destinatario no está en la lista de permitidos de una
 * app en desarrollo—. Quedarse con uno solo es quedarse sin la explicación justo
 * cuando hace falta.
 */
function parseErrors(entry: JsonObject): MessageStatusError[] {
  const errors = getArrayField(entry, 'errors') ?? [];

  return errors
    .map((raw) => asObject(raw))
    .filter((error): error is JsonObject => error !== null)
    .map((error) => {
      const code = error.code;
      const errorData = getObjectField(error, 'error_data');

      return {
        code: typeof code === 'number' ? code : null,
        title: getStringField(error, 'title'),
        detail:
          (errorData ? getStringField(errorData, 'details') : null) ??
          getStringField(error, 'message'),
      };
    });
}

/** El estado en una línea, para el log. */
export function describeMessageStatus(event: MessageStatusEvent): string {
  const partes = [
    `status=${(event.status ?? 'desconocido').toUpperCase()}`,
    `metaMessageId=${event.metaMessageId ?? 'sin id'}`,
    `recipient=${event.recipientId ?? 'sin destinatario'}`,
  ];

  for (const error of event.errors) {
    partes.push(
      `error=${String(error.code)}`,
      error.title ? `titulo="${error.title}"` : '',
      error.detail ? `detalle="${error.detail}"` : '',
    );
  }

  return partes.filter(Boolean).join(' ');
}

/** Si el estado es un fallo, que es lo único que se registra como advertencia. */
export const isFailedStatus = (event: MessageStatusEvent): boolean =>
  event.status?.toLowerCase() === 'failed';
