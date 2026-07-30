import {
  asObject,
  getArrayField,
  getObjectField,
  getStringField,
} from '../webhook/webhook-meta.util';
import {
  IncomingMessageKind,
  type IncomingMessageContext,
  type IncomingMessagePayload,
  type IncomingWhatsAppMessage,
} from './types/incoming-message.type';

/**
 * Convierte el body crudo de un webhook de Meta en un mensaje tipado.
 *
 * Devuelve `null` cuando el evento no es un mensaje de usuario procesable:
 * notificaciones de estado (`statuses`), payloads malformados o sin los datos
 * mínimos para responder (`from` y `phone_number_id`).
 */
export function parseIncomingWhatsAppMessage(
  body: unknown,
): IncomingWhatsAppMessage | null {
  const data = asObject(body);
  if (!data) return null;

  const entry = asObject(getArrayField(data, 'entry')?.[0]);
  if (!entry) return null;

  const change = asObject(getArrayField(entry, 'changes')?.[0]);
  if (!change) return null;

  const value = getObjectField(change, 'value');
  if (!value) return null;

  const message = asObject(getArrayField(value, 'messages')?.[0]);
  if (!message) return null;

  const from = getStringField(message, 'from');
  if (!from) return null;

  const metadata = getObjectField(value, 'metadata');
  const phoneNumberId = metadata
    ? getStringField(metadata, 'phone_number_id')
    : null;
  if (!phoneNumberId) return null;

  const contact = asObject(getArrayField(value, 'contacts')?.[0]);
  const profile = contact ? getObjectField(contact, 'profile') : null;

  const context: IncomingMessageContext = {
    metaMessageId: getStringField(message, 'id'),
    from,
    contactName: profile ? getStringField(profile, 'name') : null,
    phoneNumberId,
    displayPhoneNumber: metadata
      ? getStringField(metadata, 'display_phone_number')
      : null,
    timestamp: getStringField(message, 'timestamp'),
  };

  return { ...context, ...parsePayload(message) };
}

function parsePayload(
  message: Record<string, unknown>,
): IncomingMessagePayload {
  const messageType = getStringField(message, 'type');

  if (messageType === 'text') {
    const text = getObjectField(message, 'text');
    const bodyText = text ? getStringField(text, 'body') : null;
    if (bodyText !== null) {
      return { kind: IncomingMessageKind.TEXT, text: bodyText };
    }
    return { kind: IncomingMessageKind.UNSUPPORTED, messageType };
  }

  if (messageType === 'interactive') {
    return parseInteractivePayload(message, messageType);
  }

  // Botón de respuesta rápida de una plantilla: forma distinta a `interactive`.
  if (messageType === 'button') {
    const button = getObjectField(message, 'button');
    const payload = button ? getStringField(button, 'payload') : null;
    if (payload) {
      return {
        kind: IncomingMessageKind.BUTTON_REPLY,
        selectionId: payload,
        title: button ? getStringField(button, 'text') : null,
      };
    }
    return { kind: IncomingMessageKind.UNSUPPORTED, messageType };
  }

  return { kind: IncomingMessageKind.UNSUPPORTED, messageType };
}

function parseInteractivePayload(
  message: Record<string, unknown>,
  messageType: string | null,
): IncomingMessagePayload {
  const interactive = getObjectField(message, 'interactive');
  if (!interactive) {
    return { kind: IncomingMessageKind.UNSUPPORTED, messageType };
  }

  const interactiveType = getStringField(interactive, 'type');

  if (interactiveType === 'button_reply') {
    const reply = getObjectField(interactive, 'button_reply');
    const id = reply ? getStringField(reply, 'id') : null;
    if (id) {
      return {
        kind: IncomingMessageKind.BUTTON_REPLY,
        selectionId: id,
        title: reply ? getStringField(reply, 'title') : null,
      };
    }
  }

  if (interactiveType === 'list_reply') {
    const reply = getObjectField(interactive, 'list_reply');
    const id = reply ? getStringField(reply, 'id') : null;
    if (id) {
      return {
        kind: IncomingMessageKind.LIST_REPLY,
        selectionId: id,
        title: reply ? getStringField(reply, 'title') : null,
        description: reply ? getStringField(reply, 'description') : null,
      };
    }
  }

  if (interactiveType === 'nfm_reply') {
    const reply = getObjectField(interactive, 'nfm_reply');
    const rawResponseJson = reply
      ? getStringField(reply, 'response_json')
      : null;
    const response = parseFlowResponseJson(rawResponseJson);
    return {
      kind: IncomingMessageKind.FLOW_REPLY,
      flowToken: response ? readFlowToken(response) : null,
      response,
      rawResponseJson,
    };
  }

  return { kind: IncomingMessageKind.UNSUPPORTED, messageType };
}

/**
 * `response_json` llega como string. Según el cliente puede venir además
 * URL-encoded, así que se intenta el decode como segundo camino antes de darlo
 * por perdido. Nunca lanza: un Flow malformado no debe tumbar el webhook.
 */
function parseFlowResponseJson(
  raw: string | null,
): Record<string, unknown> | null {
  if (!raw) return null;

  const attempts = [raw, safeDecodeUriComponent(raw)];
  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      const parsed: unknown = JSON.parse(candidate);
      const asRecord = asObject(parsed);
      if (asRecord) return asRecord;
    } catch {
      // Se intenta la siguiente variante.
    }
  }

  return null;
}

function safeDecodeUriComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function readFlowToken(response: Record<string, unknown>): string | null {
  return getStringField(response, 'flow_token');
}
