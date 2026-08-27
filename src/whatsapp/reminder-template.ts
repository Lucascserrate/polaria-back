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

/* La categoría y el payload de creación se fueron a `template-registry`. */

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

/*
 * El estado de una plantilla se mudó a `template-status.ts` cuando dejó de haber
 * una sola. Se reexporta con los nombres viejos para no obligar a renombrar en el
 * mismo cambio que mueve el modelo.
 */
export {
  TemplateStatus as ReminderTemplateStatus,
  toTemplateStatus as toReminderTemplateStatus,
  canSendTemplate as canSendReminders,
} from './template-status';
