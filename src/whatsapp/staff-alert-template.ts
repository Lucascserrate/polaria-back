/**
 * Las plantillas con las que se le avisa a un profesional que una cita suya cambió.
 *
 * **Una por evento**, y no una parametrizada para los tres. El primer intento fue lo
 * segundo —con el encabezado y la frase como variables— y Meta lo rechazó con
 * `code=100, subcode=2388293`. La razón se ve comparando con la plantilla de
 * recordatorios, que sí está aprobada:
 *
 *     reminder     5 variables, 141 caracteres de texto, ratio 28.2
 *     parametrizada 6 variables,  34 caracteres de texto, ratio  5.7
 *
 * Meter el encabezado y la oración completa en variables dejaba un cuerpo que era
 * casi todo huecos, con `{{1}}` ocupando una línea entera por sí sola. Tres
 * plantillas cuestan tres aprobaciones por negocio, pero cada una tiene texto real
 * alrededor de sus variables —ratios de 17.5 a 20.8— y además una rechazada no
 * arrastra a las otras dos.
 *
 * Todo lo de este archivo es puro.
 */

import { TemplateKey } from './template-key';

/** Qué evento se está avisando. */
export enum StaffAlertEvent {
  CREATED = 'CREATED',
  RESCHEDULED = 'RESCHEDULED',
  CANCELLED = 'CANCELLED',
}

/**
 * Qué plantilla le corresponde a cada evento.
 *
 * Es la única traducción entre el dominio —qué le pasó a la cita— y el transporte
 * —qué plantilla aprobada mandar—. El despachador la usa y no decide nada por su
 * cuenta.
 */
export const TEMPLATE_KEY_BY_EVENT: Record<StaffAlertEvent, TemplateKey> = {
  [StaffAlertEvent.CREATED]: TemplateKey.STAFF_ALERT_NEW,
  [StaffAlertEvent.RESCHEDULED]: TemplateKey.STAFF_ALERT_MOVED,
  [StaffAlertEvent.CANCELLED]: TemplateKey.STAFF_ALERT_CANCELLED,
};

/** Igual que la de recordatorios: Polaria es un producto en español. */
export const STAFF_ALERT_TEMPLATE_LANGUAGE = 'es';

/**
 * Variables del cuerpo, en orden. Las mismas cuatro en las tres plantillas.
 *
 * Que coincidan no es casualidad ni comodidad: es lo que permite que el despachador
 * arme los parámetros una sola vez y elija la plantilla aparte. Si una llevara un
 * quinto dato, esto se partiría en tres listas.
 */
export const STAFF_ALERT_TEMPLATE_VARIABLES = [
  'clientName',
  'serviceName',
  'date',
  'time',
] as const;

export const STAFF_ALERT_NEW_TEMPLATE_NAME = 'polaria_staff_appointment_new';
export const STAFF_ALERT_MOVED_TEMPLATE_NAME =
  'polaria_staff_appointment_moved';
export const STAFF_ALERT_CANCELLED_TEMPLATE_NAME =
  'polaria_staff_appointment_cancelled';

/*
 * Los cuerpos, tal como se aprueban.
 *
 * Cambiar cualquiera de estos textos significa una plantilla nueva, con otro nombre
 * y otra aprobación, y reaprovisionar cada WABA. No son cadenas que se ajusten al
 * gusto.
 *
 * El encabezado con emoji es lo primero que se ve en la lista de chats de WhatsApp,
 * antes de abrir el mensaje: es lo que distingue los tres avisos de un vistazo, y
 * ahora es texto fijo de cada plantilla en lugar de una variable.
 */

export const STAFF_ALERT_NEW_TEMPLATE_BODY = [
  'Nueva cita agendada 📅',
  '',
  '{{1}} agendó una cita con vos.',
  '',
  'Servicio: {{2}}',
  'Fecha: {{3}}',
  'Hora: {{4}}',
].join('\n');

export const STAFF_ALERT_MOVED_TEMPLATE_BODY = [
  'Cita reprogramada 🔄',
  '',
  'La cita de {{1}} fue reprogramada.',
  '',
  'Servicio: {{2}}',
  'Fecha: {{3}}',
  'Nueva hora: {{4}}',
].join('\n');

export const STAFF_ALERT_CANCELLED_TEMPLATE_BODY = [
  'Cita cancelada ❌',
  '',
  'La cita de {{1}} fue cancelada.',
  '',
  'Servicio: {{2}}',
  'Fecha: {{3}}',
  'Hora: {{4}}',
].join('\n');

export interface StaffAlertContent {
  clientName: string | null;
  serviceName: string | null;
  /** Fecha en la zona del negocio, ya escrita. */
  date: string;
  /** Hora en la zona del negocio, ya escrita. */
  time: string;
}

/**
 * Las variables del cuerpo, en el orden de `STAFF_ALERT_TEMPLATE_VARIABLES`.
 *
 * Ninguna puede quedar vacía: Meta rechaza el envío si una variable llega como
 * cadena vacía, y el mensaje no llega. De ahí los respaldos.
 *
 * No recibe el evento: los cuatro datos son los mismos para los tres avisos, y qué
 * plantilla los recibe lo decide `TEMPLATE_KEY_BY_EVENT`. Separar las dos cosas es
 * lo que evita un `switch` acá adentro.
 */
export function buildStaffAlertParameters(
  content: StaffAlertContent,
): string[] {
  return [
    content.clientName?.trim() || 'Un cliente',
    content.serviceName?.trim() || 'Servicio',
    content.date,
    content.time,
  ];
}
