import {
  AppointmentAction,
  encodeAppointmentAction,
} from '../booking-flow/appointment-actions';
import {
  REMINDER_TEMPLATE_BODY,
  REMINDER_TEMPLATE_BUTTONS,
} from '../whatsapp/reminder-template';

/**
 * Contenido del recordatorio: las variables de la plantilla y los payloads de
 * sus botones. Puro, para poder verificar el orden sin enviar nada.
 */

export type ReminderMessageInput = {
  appointmentId: string;
  clientName: string | null;
  businessName: string | null;
  serviceName: string | null;
  professionalName: string | null;
  startTime: Date;
  timezone: string;
};

export type ReminderMessage = {
  /** En el orden de `{{1}}`…`{{5}}` de la plantilla aprobada. */
  bodyParameters: string[];
  /** En el orden en que los botones quedaron aprobados. */
  quickReplyPayloads: string[];
};

/**
 * `jueves 21 de agosto, 16:00` en la zona horaria del negocio.
 *
 * La zona importa **acá y solo acá**: el momento del envío es aritmética de
 * instantes, pero el texto tiene que decir la hora que el cliente va a leer en
 * la puerta del local.
 */
export function formatReminderDateTime(
  startTime: Date,
  timezone: string,
): string {
  const date = new Intl.DateTimeFormat('es', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(startTime);

  const time = new Intl.DateTimeFormat('es', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(startTime);

  return `${date}, ${time}`;
}

/**
 * Arma el recordatorio.
 *
 * Los botones llevan el mismo codec `appt|v1|` que ya usa el menú de citas del
 * flujo guiado, así que reagendar y cancelar desde el recordatorio entran por el
 * camino que ya existe: no hay manejo nuevo del lado del webhook.
 *
 * El orden de los payloads sigue al de `REMINDER_TEMPLATE_BUTTONS`, porque al
 * enviar cada botón se identifica por su índice y no por su texto. Invertirlos
 * haría que "Reagendar" cancelara la cita.
 */
export function buildReminderMessage(
  input: ReminderMessageInput,
): ReminderMessage {
  const actionByLabel: Record<string, AppointmentAction> = {
    Reagendar: AppointmentAction.RESCHEDULE,
    Cancelar: AppointmentAction.CANCEL,
  };

  return {
    bodyParameters: [
      input.clientName?.trim() || 'Hola',
      input.businessName?.trim() || 'tu negocio de confianza',
      input.serviceName?.trim() || 'tu servicio',
      input.professionalName?.trim() || 'el equipo',
      formatReminderDateTime(input.startTime, input.timezone),
    ],
    quickReplyPayloads: REMINDER_TEMPLATE_BUTTONS.map((label) =>
      encodeAppointmentAction(actionByLabel[label], input.appointmentId),
    ),
  };
}

/** Datos de ejemplo para la vista previa. No sale nada real con ellos. */
const PREVIEW_EXAMPLE = {
  clientName: 'Lucas',
  serviceName: 'Corte',
  professionalName: 'Diego',
  appointmentDateTime: 'mañana a las 17:00',
};

/**
 * El mensaje tal como lo va a recibir el cliente, con datos de ejemplo.
 *
 * Rellena la **misma** plantilla que usa el envío real, en el mismo orden de
 * variables. Es la única forma de que la vista previa no pueda mentir: si el
 * panel escribiera el texto por su cuenta, cambiar la plantilla dejaría al
 * negocio aprobando un mensaje que ya no es el que sale.
 */
export function buildReminderPreview(businessName: string): string {
  const values = [
    PREVIEW_EXAMPLE.clientName,
    businessName?.trim() || 'tu negocio',
    PREVIEW_EXAMPLE.serviceName,
    PREVIEW_EXAMPLE.professionalName,
    PREVIEW_EXAMPLE.appointmentDateTime,
  ];

  return REMINDER_TEMPLATE_BODY.replace(
    /{{(\d+)}}/g,
    (match, index: string) => values[Number(index) - 1] ?? match,
  );
}
