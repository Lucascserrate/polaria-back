import {
  REMINDER_TEMPLATE_BODY,
  REMINDER_TEMPLATE_BUTTONS,
  REMINDER_TEMPLATE_LANGUAGE,
  REMINDER_TEMPLATE_NAME,
} from './reminder-template';
import {
  STAFF_ALERT_TEMPLATE_BODY,
  STAFF_ALERT_TEMPLATE_LANGUAGE,
  STAFF_ALERT_TEMPLATE_NAME,
} from './staff-alert-template';

/**
 * Las plantillas que Polaria aprovisiona en la WABA de cada negocio.
 *
 * Antes había una sola y su estado vivía en cuatro columnas de `tenants`. Con dos
 * eso ya no cierra —serían ocho columnas, y el job de estado y el webhook tendrían
 * la plantilla cableada en singular— así que el estado se mudó a
 * `whatsapp_templates` y acá queda lo que no depende del negocio: cómo se llama
 * cada una, qué dice y cómo se crea en Meta.
 *
 * Todo lo de este archivo es puro.
 */

export enum TemplateKey {
  /** Recordatorio de cita al **cliente**. */
  REMINDER = 'reminder',
  /** Aviso al **profesional** de que una cita suya cambió. */
  STAFF_ALERT = 'staff_alert',
}

export const TEMPLATE_KEYS: readonly TemplateKey[] = [
  TemplateKey.REMINDER,
  TemplateKey.STAFF_ALERT,
];

/**
 * `UTILITY` y no `MARKETING` en las dos: son avisos sobre una transacción que ya
 * existe. La categoría cambia el precio y las reglas de aprobación, y un aviso de
 * cita clasificado como marketing sería rechazado.
 */
const CATEGORY = 'UTILITY';

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
   * con `urlButtonSuffix`. Es lo que permite que el botón lleve a la fecha de la
   * cita y no a la agenda de hoy.
   */
  urlButton?: {
    text: string;
    path: string;
    dynamicSuffix?: { template: string; example: string };
  };
  /** Un ejemplo por variable, en orden. Meta los exige para poder revisar. */
  example: readonly string[];
}

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
  [TemplateKey.STAFF_ALERT]: {
    key: TemplateKey.STAFF_ALERT,
    name: STAFF_ALERT_TEMPLATE_NAME,
    language: STAFF_ALERT_TEMPLATE_LANGUAGE,
    body: STAFF_ALERT_TEMPLATE_BODY,
    quickReplies: [],
    urlButton: {
      text: 'Ver mi agenda',
      path: '/mi-agenda',
      // La agenda del profesional acepta `?date=`: el botón cae en el día de la
      // cita en lugar de en hoy.
      dynamicSuffix: { template: '?date={{1}}', example: '2026-08-21' },
    },
    example: [
      'Nueva cita agendada 📅',
      'Diego',
      'Carlos Pérez agendó una cita con vos.',
      'Corte',
      'jueves 21 de agosto',
      '16:00',
    ],
  },
};

export const templateDefinition = (key: TemplateKey): TemplateDefinition =>
  DEFINITIONS[key];

/**
 * Cuerpo del `POST /{waba-id}/message_templates`.
 *
 * Ojo con el uso de mayúsculas: al **crear** una plantilla los componentes van en
 * mayúsculas (`BODY`, `BUTTONS`, `QUICK_REPLY`, `URL`) y al **enviarla** en
 * minúsculas (`body`, `button`, `quick_reply`). Es asimétrico en la API de Meta y
 * no es un error de tipeo.
 *
 * @param clientBaseUrl Base del panel, para el botón de enlace. Sin ella el botón
 * se omite en lugar de crearse apuntando a ninguna parte: una plantilla con un
 * enlace roto se aprueba igual, y el profesional descubre el problema al tocarlo.
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
      // Meta exige un ejemplo del valor dinámico para poder revisar el botón.
      ...(dynamicSuffix ? { example: [dynamicSuffix.example] } : {}),
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
