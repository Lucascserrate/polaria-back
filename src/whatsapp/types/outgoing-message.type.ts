/**
 * Componentes salientes de WhatsApp y sus límites reales.
 *
 * Los límites están codificados porque el flujo guiado depende de ellos: una
 * lista nativa no admite más de 10 filas, y superarlos hace que Meta rechace el
 * mensaje con un error opaco. Es mejor detectarlo en nuestro código.
 *
 * Fuente: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-list-messages
 *         https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-reply-buttons-messages
 */
export const WHATSAPP_LIMITS = {
  /** Botones de respuesta rápida por mensaje. */
  BUTTONS_MAX_COUNT: 3,
  BUTTON_TITLE_MAX: 20,
  BUTTON_ID_MAX: 256,

  /** Filas totales de una lista, sumando todas las secciones. */
  LIST_ROWS_MAX_COUNT: 10,
  LIST_SECTIONS_MAX_COUNT: 10,
  LIST_ROW_TITLE_MAX: 24,
  LIST_ROW_DESCRIPTION_MAX: 72,
  LIST_ROW_ID_MAX: 200,
  LIST_BUTTON_TEXT_MAX: 20,
  LIST_SECTION_TITLE_MAX: 24,

  /** Versión del protocolo del mensaje que abre un Flow. */
  FLOW_MESSAGE_VERSION: '3',
  /** Etiqueta del botón que abre el Flow. */
  FLOW_CTA_MAX: 20,

  /** El body de una lista admite más texto que el de un mensaje con botones. */
  BUTTONS_BODY_MAX: 1024,
  LIST_BODY_MAX: 4096,
  HEADER_TEXT_MAX: 60,
  FOOTER_TEXT_MAX: 60,
} as const;

export type WhatsAppCredentials = {
  accessToken: string;
  phoneNumberId: string;
};

export type OutgoingButton = {
  /** Identificador que volverá intacto en el `button_reply`. */
  id: string;
  title: string;
};

export type OutgoingListRow = {
  /** Identificador que volverá intacto en el `list_reply`. */
  id: string;
  title: string;
  description?: string;
};

export type OutgoingListSection = {
  title?: string;
  rows: OutgoingListRow[];
};

export type SendTextInput = {
  to: string;
  body: string;
  previewUrl?: boolean;
};

export type SendButtonsInput = {
  to: string;
  body: string;
  buttons: OutgoingButton[];
  header?: string;
  footer?: string;
};

/**
 * Apertura de un WhatsApp Flow.
 *
 * `flowToken` es lo que ata la sesión de reserva a este Flow: vuelve en cada
 * `data_exchange` del endpoint y en el `nfm_reply` del cierre.
 */
export type SendFlowInput = {
  to: string;
  body: string;
  /** Etiqueta del botón que abre el Flow (ej. "Reservar turno"). */
  cta: string;
  flowId: string;
  flowToken: string;
  header?: string;
  footer?: string;
};

export type SendListInput = {
  to: string;
  body: string;
  /** Etiqueta del botón que despliega la lista (ej. "Ver horarios"). */
  buttonText: string;
  sections: OutgoingListSection[];
  header?: string;
  footer?: string;
};

/**
 * Error de construcción de un mensaje interactivo: indica que el renderizador
 * produjo algo que WhatsApp no puede mostrar (por ejemplo, 11 horarios en una
 * lista). Es un bug nuestro, no una condición del usuario.
 */
export class WhatsAppMessageBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhatsAppMessageBuildError';
  }
}
