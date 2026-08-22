/**
 * La plantilla de recordatorio de citas, y cómo se lee su estado.
 *
 * Vive acá y no en el módulo de recordatorios porque es un artefacto de
 * WhatsApp: una plantilla pertenece a una WABA, se aprueba por WABA y su forma
 * la dicta Meta. El dominio de recordatorios solo necesita saber si puede usarla.
 *
 * Todo lo de este archivo es puro. El acceso a Graph vive en el servicio.
 */

/**
 * Nombre de la plantilla. Meta solo admite minúsculas, números y guion bajo.
 *
 * Es el mismo para todos los negocios: cada uno la tiene en su propia WABA, así
 * que no hay colisión posible y un nombre estable permite reconocerla al
 * reconectar sin guardar nada más.
 */
export const REMINDER_TEMPLATE_NAME = 'polaria_appointment_reminder';

/**
 * Idioma con el que se aprueba. Tiene que coincidir exactamente al enviar.
 *
 * Constante por ahora: Polaria es un producto en español. Cuando haya negocios
 * en otro idioma, esto pasa a ser un campo del tenant y la plantilla se aprueba
 * una vez por idioma.
 */
export const REMINDER_TEMPLATE_LANGUAGE = 'es';

/**
 * `UTILITY` y no `MARKETING`: es un aviso sobre una transacción que el cliente
 * ya inició. La categoría cambia el precio y las reglas de aprobación, y una
 * plantilla de recordatorio clasificada como marketing sería rechazada.
 */
const REMINDER_TEMPLATE_CATEGORY = 'UTILITY';

/**
 * Variables del cuerpo, en orden. El envío debe respetarlo.
 *
 * Se expone como constante para que quien construya el mensaje no tenga que
 * deducir el orden leyendo el texto.
 */
export const REMINDER_TEMPLATE_VARIABLES = [
  'clientName',
  'businessName',
  'serviceName',
  'professionalName',
  'appointmentDateTime',
] as const;

/**
 * Cuerpo aprobado por Meta.
 *
 * Se exporta para que la vista previa del panel salga de acá y no de una
 * copia: el negocio tiene que ver exactamente lo que va a recibir su cliente.
 * Cambiar este texto significa una plantilla nueva, con otro nombre y otra
 * aprobación, y reaprovisionar cada WABA.
 */
export const REMINDER_TEMPLATE_BODY = [
  'Hola {{1}} 👋',
  '',
  'Te recordamos tu cita en {{2}}.',
  '',
  'Servicio: {{3}}',
  'Profesional: {{4}}',
  'Fecha y hora: {{5}}',
  '',
  'Si necesitás cambiarla o cancelarla, usá los botones de abajo.',
].join('\n');

/**
 * Botones de respuesta rápida, en orden.
 *
 * El orden es parte del contrato: al enviar, el payload de cada botón se
 * identifica por su índice, no por su texto. Cambiar el orden acá sin cambiarlo
 * al enviar haría que "Reagendar" cancelara la cita.
 */
export const REMINDER_TEMPLATE_BUTTONS = ['Reagendar', 'Cancelar'] as const;

/**
 * Estado de la plantilla, en los términos que le importan a Polaria.
 *
 * Meta maneja nueve estados (`APPROVED`, `PENDING`, `IN_APPEAL`, `REJECTED`,
 * `PAUSED`, `DISABLED`, `LIMIT_EXCEEDED`, `PENDING_DELETION`, `DELETED`). Se
 * traducen a cuatro porque el planificador de recordatorios solo tiene una
 * pregunta —¿puedo enviar?— y obligar a cada consumidor a conocer los nueve
 * garantiza que alguno olvide tratar `PAUSED` como "no".
 */
export enum ReminderTemplateStatus {
  /** No se creó todavía, o el negocio no tiene WhatsApp conectado. */
  NOT_CREATED = 'NOT_CREATED',
  /** Creada y esperando revisión de Meta. Se resuelve sola. */
  PENDING = 'PENDING',
  /** Lista para enviar. */
  APPROVED = 'APPROVED',
  /** No se puede enviar y no se resuelve esperando: hace falta intervenir. */
  UNAVAILABLE = 'UNAVAILABLE',
}

/** Traduce el estado que informa Meta al de Polaria. */
export function toReminderTemplateStatus(
  metaStatus: string | null | undefined,
): ReminderTemplateStatus {
  switch (metaStatus?.toUpperCase()) {
    case 'APPROVED':
      return ReminderTemplateStatus.APPROVED;
    case 'PENDING':
    case 'IN_APPEAL':
    case 'PENDING_DELETION':
      return ReminderTemplateStatus.PENDING;
    case undefined:
      return ReminderTemplateStatus.NOT_CREATED;
    default:
      // `REJECTED`, `PAUSED`, `DISABLED`, `LIMIT_EXCEEDED`, `DELETED` y
      // cualquier estado que Meta agregue: sin enviar hasta saber qué es.
      return ReminderTemplateStatus.UNAVAILABLE;
  }
}

/** Solo con la plantilla aprobada se puede iniciar una conversación. */
export function canSendReminders(status: string | null | undefined): boolean {
  return status === ReminderTemplateStatus.APPROVED;
}

/**
 * Cuerpo del `POST /{waba-id}/message_templates`.
 *
 * Ojo con el uso de mayúsculas: al **crear** una plantilla los componentes van
 * en mayúsculas (`BODY`, `BUTTONS`, `QUICK_REPLY`) y al **enviarla** en
 * minúsculas (`body`, `button`, `quick_reply`). Es asimétrico en la API de Meta
 * y no es un error de tipeo.
 *
 * Los ejemplos son obligatorios cuando el cuerpo tiene variables: sin ellos
 * Meta rechaza la plantilla porque no puede evaluar el texto real.
 */
export function buildReminderTemplateCreatePayload(): Record<string, unknown> {
  return {
    name: REMINDER_TEMPLATE_NAME,
    language: REMINDER_TEMPLATE_LANGUAGE,
    category: REMINDER_TEMPLATE_CATEGORY,
    components: [
      {
        type: 'BODY',
        text: REMINDER_TEMPLATE_BODY,
        example: {
          body_text: [
            [
              'María',
              'Studio Nova',
              'Corte',
              'Diego',
              'jueves 21 de agosto, 16:00',
            ],
          ],
        },
      },
      {
        type: 'BUTTONS',
        buttons: REMINDER_TEMPLATE_BUTTONS.map((text) => ({
          type: 'QUICK_REPLY',
          text,
        })),
      },
    ],
  };
}
