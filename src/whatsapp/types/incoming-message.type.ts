/**
 * Representación tipada de un mensaje entrante de WhatsApp.
 *
 * El punto clave del flujo guiado de reservas: cuando el usuario responde a una
 * lista o a un botón, WhatsApp devuelve el `id` que nosotros mismos generamos.
 * Ese `selectionId` es un dato estructurado y válido por construcción, y es la
 * única fuente de verdad admitida durante una reserva. El texto libre nunca lo es.
 */

export enum IncomingMessageKind {
  /** Texto libre escrito por el usuario. */
  TEXT = 'TEXT',
  /** Respuesta a un botón de respuesta rápida (interactive o plantilla). */
  BUTTON_REPLY = 'BUTTON_REPLY',
  /** Selección de una fila de una lista interactiva. */
  LIST_REPLY = 'LIST_REPLY',
  /** Envío completado de un WhatsApp Flow (nfm_reply). */
  FLOW_REPLY = 'FLOW_REPLY',
  /** Cualquier otro tipo (audio, imagen, sticker, ubicación, etc.). */
  UNSUPPORTED = 'UNSUPPORTED',
}

/** Metadatos comunes a todo mensaje entrante. */
export type IncomingMessageContext = {
  /** `id` asignado por Meta al mensaje. Útil para trazas e idempotencia. */
  metaMessageId: string | null;
  /** Teléfono del usuario que escribe. */
  from: string;
  /** Nombre del perfil de WhatsApp, si viene en `contacts`. */
  contactName: string | null;
  /** `phone_number_id` del número del negocio que recibió el mensaje. */
  phoneNumberId: string;
  /** Número visible del negocio; se usa para resolver el tenant. */
  displayPhoneNumber: string | null;
  /** Timestamp de Meta (epoch en segundos, como string). */
  timestamp: string | null;
};

export type IncomingTextPayload = {
  kind: IncomingMessageKind.TEXT;
  text: string;
};

export type IncomingButtonReplyPayload = {
  kind: IncomingMessageKind.BUTTON_REPLY;
  /** `id` del botón que nosotros generamos al enviarlo. */
  selectionId: string;
  /** Etiqueta visible. Solo para logs; nunca para decidir. */
  title: string | null;
};

export type IncomingListReplyPayload = {
  kind: IncomingMessageKind.LIST_REPLY;
  /** `id` de la fila que nosotros generamos al enviarla. */
  selectionId: string;
  title: string | null;
  description: string | null;
};

export type IncomingFlowReplyPayload = {
  kind: IncomingMessageKind.FLOW_REPLY;
  /** Token que enviamos al abrir el Flow; permite atar la respuesta a su sesión. */
  flowToken: string | null;
  /** `response_json` ya parseado, o `null` si no se pudo parsear. */
  response: Record<string, unknown> | null;
  /** `response_json` en crudo, para diagnóstico cuando el parseo falla. */
  rawResponseJson: string | null;
};

export type IncomingUnsupportedPayload = {
  kind: IncomingMessageKind.UNSUPPORTED;
  /** Valor de `message.type` reportado por Meta. */
  messageType: string | null;
};

export type IncomingMessagePayload =
  | IncomingTextPayload
  | IncomingButtonReplyPayload
  | IncomingListReplyPayload
  | IncomingFlowReplyPayload
  | IncomingUnsupportedPayload;

export type IncomingWhatsAppMessage = IncomingMessageContext &
  IncomingMessagePayload;

/**
 * Mensajes que aportan un dato estructurado y por lo tanto pueden hacer avanzar
 * una reserva. El texto libre queda deliberadamente fuera.
 */
export const INTERACTIVE_KINDS: readonly IncomingMessageKind[] = [
  IncomingMessageKind.BUTTON_REPLY,
  IncomingMessageKind.LIST_REPLY,
  IncomingMessageKind.FLOW_REPLY,
];

export function isInteractiveMessage(
  message: IncomingWhatsAppMessage,
): message is IncomingMessageContext &
  (
    | IncomingButtonReplyPayload
    | IncomingListReplyPayload
    | IncomingFlowReplyPayload
  ) {
  return INTERACTIVE_KINDS.includes(message.kind);
}
