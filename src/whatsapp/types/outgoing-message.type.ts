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

  /** Botones de respuesta rápida de una plantilla, iguales en número a los nativos. */
  TEMPLATE_QUICK_REPLY_MAX_COUNT: 3,
  /**
   * Largo de una variable del cuerpo de una plantilla.
   *
   * Se recorta en lugar de dejar que Meta rechace el envío: un nombre de
   * servicio larguísimo no puede impedir que salga el recordatorio.
   */
  TEMPLATE_PARAMETER_MAX: 1024,

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

/**
 * Mensaje de plantilla aprobada.
 *
 * Es la única forma de escribirle a un cliente fuera de la ventana de 24 horas
 * que abre su último mensaje. Un recordatorio de cita cae siempre fuera de esa
 * ventana, así que no hay alternativa: con texto libre Meta responde 131047.
 *
 * La plantilla, su idioma y la cantidad y el orden de sus botones se fijan al
 * aprobarla en la WABA. Lo único que viaja en cada envío son las variables del
 * cuerpo y el payload de cada botón, y esto último es lo que permite reutilizar
 * el codec de acciones sobre citas que ya existe.
 */
export type SendTemplateInput = {
  to: string;
  /** Nombre exacto con el que la plantilla quedó aprobada en la WABA. */
  name: string;
  /**
   * Idioma con el que se aprobó, tal como lo espera Meta (`es`, `es_ES`,
   * `en_US`). Si no coincide exactamente, el envío falla.
   */
  languageCode: string;
  /** Variables del cuerpo, en el orden de `{{1}}`, `{{2}}`… */
  bodyParameters?: string[];
  /**
   * Payloads de los botones de respuesta rápida, en el mismo orden en que están
   * en la plantilla aprobada. Cada uno vuelve intacto al tocarlo.
   */
  quickReplyPayloads?: string[];
  /**
   * Valor del `{{1}}` de un botón de enlace, cuando la plantilla lo declara así.
   *
   * Meta llama a esto "sufijo dinámico": la plantilla se aprueba con la URL
   * terminada en `{{1}}` y al enviar se manda lo que va ahí. Es lo que permite que
   * el botón lleve a la fecha de **esta** cita en lugar de a la agenda de hoy.
   *
   * Va **después** de los botones de respuesta rápida en la plantilla, así que su
   * índice es la cantidad de esos botones. Ver `buildTemplatePayload`.
   */
  urlButtonSuffix?: string;
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
