import {
  REMINDER_TEMPLATE_BODY,
  REMINDER_TEMPLATE_BUTTONS,
  REMINDER_TEMPLATE_LANGUAGE,
  REMINDER_TEMPLATE_NAME,
} from './reminder-template';
import {
  STAFF_ALERT_CANCELLED_TEMPLATE_BODY,
  STAFF_ALERT_CANCELLED_TEMPLATE_NAME,
  STAFF_ALERT_MOVED_TEMPLATE_BODY,
  STAFF_ALERT_MOVED_TEMPLATE_NAME,
  STAFF_ALERT_NEW_TEMPLATE_BODY,
  STAFF_ALERT_NEW_TEMPLATE_NAME,
  STAFF_ALERT_TEMPLATE_LANGUAGE,
} from './staff-alert-template';
import { TemplateKey } from './template-key';

/**
 * Las plantillas que Polaria aprovisiona en la WABA de cada negocio.
 *
 * Antes había una sola y su estado vivía en cuatro columnas de `tenants`. Con cuatro
 * eso no cerraría —serían dieciséis columnas, y el job de estado y el webhook
 * tendrían la plantilla cableada en singular— así que el estado se mudó a
 * `whatsapp_templates` y acá queda lo que no depende del negocio: cómo se llama cada
 * una, qué dice y cómo se crea en Meta.
 *
 * Todo lo de este archivo es puro.
 */

/*
 * `TemplateKey` y `TEMPLATE_KEYS` viven en `template-key.ts`, sin importar nada, para
 * cortar el ciclo con los cuerpos de las plantillas. Se reexportan porque este es el
 * archivo por el que el resto del código entra al tema.
 */
export { TemplateKey, TEMPLATE_KEYS } from './template-key';

/**
 * `UTILITY` y no `MARKETING` en todas: son avisos sobre una transacción que ya
 * existe. La categoría cambia el precio y las reglas de aprobación, y un aviso de
 * cita clasificado como marketing sería rechazado.
 */
const CATEGORY = 'UTILITY';

/** Texto del botón de enlace, común a las plantillas que lo llevan. */
const AGENDA_BUTTON_TEXT = 'Ver mi agenda';

interface TemplateDefinition {
  key: TemplateKey;
  name: string;
  language: string;
  body: string;
  /** Textos de los botones de respuesta rápida, en orden. Vacío si no lleva. */
  quickReplies: readonly string[];
  /**
   * Botón de enlace, si lleva. La URL se resuelve al crear: depende del entorno.
   *
   * `dynamicSuffix` declara la URL terminada en `{{1}}`, que al enviar se completa
   * con `urlButtonSuffix`. Es lo que permite que el botón lleve a la fecha de la cita
   * y no a la agenda de hoy.
   */
  urlButton?: {
    text: string;
    path: string;
    dynamicSuffix?: { template: string; example: string };
  };
  /** Un ejemplo por variable, en orden. Meta los exige para poder revisar. */
  example: readonly string[];
}

/** Las cuatro variables son las mismas en las tres plantillas del equipo. */
const STAFF_ALERT_EXAMPLE = [
  'Carlos Pérez',
  'Corte',
  'jueves 21 de agosto',
  '16:00',
] as const;

/** El botón que lleva al profesional a su agenda, en el día de la cita. */
const AGENDA_BUTTON = {
  text: AGENDA_BUTTON_TEXT,
  path: '/mi-agenda',
  dynamicSuffix: { template: '?date={{1}}', example: '2026-08-21' },
};

const DEFINITIONS: Record<TemplateKey, TemplateDefinition> = {
  [TemplateKey.REMINDER]: {
    key: TemplateKey.REMINDER,
    name: REMINDER_TEMPLATE_NAME,
    language: REMINDER_TEMPLATE_LANGUAGE,
    body: REMINDER_TEMPLATE_BODY,
    quickReplies: REMINDER_TEMPLATE_BUTTONS,
    example: [
      'María',
      'Studio Nova',
      'Corte',
      'Diego',
      'jueves 21 de agosto, 16:00',
    ],
  },
  [TemplateKey.STAFF_ALERT_NEW]: {
    key: TemplateKey.STAFF_ALERT_NEW,
    name: STAFF_ALERT_NEW_TEMPLATE_NAME,
    language: STAFF_ALERT_TEMPLATE_LANGUAGE,
    body: STAFF_ALERT_NEW_TEMPLATE_BODY,
    quickReplies: [],
    urlButton: AGENDA_BUTTON,
    example: STAFF_ALERT_EXAMPLE,
  },
  [TemplateKey.STAFF_ALERT_MOVED]: {
    key: TemplateKey.STAFF_ALERT_MOVED,
    name: STAFF_ALERT_MOVED_TEMPLATE_NAME,
    language: STAFF_ALERT_TEMPLATE_LANGUAGE,
    body: STAFF_ALERT_MOVED_TEMPLATE_BODY,
    quickReplies: [],
    urlButton: AGENDA_BUTTON,
    example: STAFF_ALERT_EXAMPLE,
  },
  [TemplateKey.STAFF_ALERT_CANCELLED]: {
    key: TemplateKey.STAFF_ALERT_CANCELLED,
    name: STAFF_ALERT_CANCELLED_TEMPLATE_NAME,
    language: STAFF_ALERT_TEMPLATE_LANGUAGE,
    body: STAFF_ALERT_CANCELLED_TEMPLATE_BODY,
    quickReplies: [],
    /*
     * Sin botón, a propósito.
     *
     * La cita ya no existe, así que "ver mi agenda" llevaría a un día donde no hay
     * nada que ver. El aviso cierra el asunto en lugar de invitar a una pantalla que
     * no va a explicar nada.
     */
    example: STAFF_ALERT_EXAMPLE,
  },
};

export const templateDefinition = (key: TemplateKey): TemplateDefinition =>
  DEFINITIONS[key];

/**
 * Cuerpo del `POST /{waba-id}/message_templates`.
 *
 * Ojo con el uso de mayúsculas: al **crear** una plantilla los componentes van en
 * mayúsculas (`BODY`, `BUTTONS`, `QUICK_REPLY`, `URL`) y al **enviarla** en
 * minúsculas (`body`, `button`, `quick_reply`). Es asimétrico en la API de Meta y no
 * es un error de tipeo.
 *
 * @param clientBaseUrl Base del panel, para el botón de enlace. Sin ella el botón se
 * omite en lugar de crearse apuntando a ninguna parte: una plantilla con un enlace
 * roto se aprueba igual, y el profesional descubre el problema al tocarlo.
 */
export function buildTemplateCreatePayload(
  key: TemplateKey,
  clientBaseUrl?: string,
): Record<string, unknown> {
  const definition = DEFINITIONS[key];

  const components: Record<string, unknown>[] = [
    {
      type: 'BODY',
      text: definition.body,
      example: { body_text: [[...definition.example]] },
    },
  ];

  const buttons: Record<string, unknown>[] = definition.quickReplies.map(
    (text) => ({ type: 'QUICK_REPLY', text }),
  );

  if (definition.urlButton && clientBaseUrl) {
    const { text, path, dynamicSuffix } = definition.urlButton;
    const base = `${clientBaseUrl.replace(/\/$/, '')}${path}`;

    buttons.push({
      type: 'URL',
      text,
      url: dynamicSuffix ? `${base}${dynamicSuffix.template}` : base,
      /*
       * El ejemplo de un botón de enlace es la **URL completa** con el valor ya
       * sustituido, no el valor suelto.
       *
       * Mandar solo `"2026-08-21"` fue uno de los tres errores del payload que Meta
       * rechazó: es un campo con la forma equivocada, y `Invalid parameter` es
       * exactamente lo que responde a eso.
       */
      ...(dynamicSuffix
        ? {
            example: [
              `${base}${dynamicSuffix.template.replace(
                /\{\{1\}\}/,
                dynamicSuffix.example,
              )}`,
            ],
          }
        : {}),
    });
  }

  if (buttons.length > 0) {
    components.push({ type: 'BUTTONS', buttons });
  }

  return {
    name: definition.name,
    language: definition.language,
    category: CATEGORY,
    components,
  };
}
