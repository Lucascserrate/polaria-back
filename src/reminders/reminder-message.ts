import {
  AppointmentAction,
  encodeAppointmentAction,
} from '../booking-flow/appointment-actions';
import { REMINDER_TEMPLATE_BUTTONS } from '../whatsapp/reminder-template';

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
