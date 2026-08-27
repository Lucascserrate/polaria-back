/**
 * La plantilla con la que se le avisa a un profesional que una cita suya cambió.
 *
 * **Una sola plantilla para los tres eventos**, con el encabezado y la frase como
 * variables. La alternativa era una por evento —nueva, reprogramada, cancelada— y
 * el costo de esa alternativa no es de código: cada plantilla se aprueba por WABA,
 * la aprobación es asincrónica y puede ser rechazada. Tres plantillas son tres
 * aprobaciones por negocio antes de que la función sirva de algo, y tres cosas que
 * pueden quedar trabadas.
 *
 * Lo que se pierde es control del copy: no se puede, por ejemplo, poner "Antes:
 * 15:30 / Ahora: 17:00" solo en la de reprogramada. Se compensa metiendo eso en la
 * frase, que es una variable de texto libre.
 *
 * Todo lo de este archivo es puro.
 */

export const STAFF_ALERT_TEMPLATE_NAME = 'polaria_staff_appointment_alert';

/** Igual que la de recordatorios: Polaria es un producto en español. */
export const STAFF_ALERT_TEMPLATE_LANGUAGE = 'es';

/**
 * Variables del cuerpo, en orden. El envío debe respetarlo.
 *
 * Se expone como constante para que quien construya el mensaje no tenga que
 * deducir el orden leyendo el texto.
 */
export const STAFF_ALERT_TEMPLATE_VARIABLES = [
  /** "Nueva cita agendada 📅", "Cita reprogramada 🔄", "Cita cancelada ❌". */
  'heading',
  'professionalName',
  /** "Carlos Pérez agendó una cita con vos." */
  'sentence',
  'serviceName',
  'date',
  'time',
] as const;

/**
 * Cuerpo aprobado por Meta.
 *
 * Cambiar este texto significa una plantilla nueva, con otro nombre y otra
 * aprobación, y reaprovisionar cada WABA. No es una cadena que se ajuste al gusto.
 *
 * El encabezado va como variable y no como componente `HEADER` porque un header de
 * texto en Meta admite una sola variable y complica el ejemplo de aprobación; en el
 * cuerpo, con una línea en blanco debajo, se lee igual.
 */
export const STAFF_ALERT_TEMPLATE_BODY = [
  '{{1}}',
  '',
  'Hola {{2}}.',
  '',
  '{{3}}',
  '',
  'Servicio: {{4}}',
  'Fecha: {{5}}',
  'Hora: {{6}}',
].join('\n');

/** Qué evento se está avisando. */
export enum StaffAlertEvent {
  CREATED = 'CREATED',
  RESCHEDULED = 'RESCHEDULED',
  CANCELLED = 'CANCELLED',
}

/**
 * El encabezado de cada evento.
 *
 * Con emoji porque es lo primero que se ve en la lista de chats de WhatsApp, antes
 * de abrir el mensaje: distingue los tres avisos de un vistazo.
 */
const HEADINGS: Record<StaffAlertEvent, string> = {
  [StaffAlertEvent.CREATED]: 'Nueva cita agendada 📅',
  [StaffAlertEvent.RESCHEDULED]: 'Cita reprogramada 🔄',
  [StaffAlertEvent.CANCELLED]: 'Cita cancelada ❌',
};

export interface StaffAlertContent {
  event: StaffAlertEvent;
  professionalName: string;
  clientName: string | null;
  serviceName: string | null;
  /** Fecha en la zona del negocio, ya escrita. */
  date: string;
  /** Hora en la zona del negocio, ya escrita. */
  time: string;
  /**
   * Hora anterior, solo en una reprogramación y solo si cambió.
   *
   * Cuando está, la frase la menciona: saber de dónde se movió el turno es lo que
   * permite entender el cambio sin abrir el panel.
   */
  previousTime?: string | null;
}

/**
 * Las variables del cuerpo, en el orden de `STAFF_ALERT_TEMPLATE_VARIABLES`.
 *
 * Ninguna puede quedar vacía: Meta rechaza el envío si una variable llega como
 * cadena vacía, y el mensaje no llega. De ahí los respaldos.
 */
export function buildStaffAlertParameters(
  content: StaffAlertContent,
): string[] {
  return [
    HEADINGS[content.event],
    content.professionalName,
    describeEvent(content),
    content.serviceName ?? 'Servicio',
    content.date,
    content.time,
  ];
}

/** La frase que explica qué pasó. */
function describeEvent(content: StaffAlertContent): string {
  const client = content.clientName?.trim() || 'Un cliente';

  switch (content.event) {
    case StaffAlertEvent.CREATED:
      return `${client} agendó una cita con vos.`;

    case StaffAlertEvent.RESCHEDULED:
      return content.previousTime
        ? `La cita con ${client} se movió de las ${content.previousTime} a las ${content.time}.`
        : `La cita con ${client} fue reprogramada.`;

    case StaffAlertEvent.CANCELLED:
      return `La cita con ${client} fue cancelada.`;
  }
}
