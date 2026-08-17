/**
 * Acciones sobre citas que el cliente ya tiene.
 *
 * Es un flujo aparte del de reserva: no crea nada, opera sobre lo existente. Por
 * eso tiene su propio espacio de ids —`appt|…`, distinto de `b1|…` y de `menu|…`—
 * y el coordinador despacha cada familia por su prefijo.
 *
 * Detectar no es impedir: cuando el cliente ya tiene turno se le pregunta qué
 * quiere hacer, y una de las opciones es sacar otro. Alguien puede estar
 * reservando para un familiar o para otro día, y bloquearlo sería imponer una
 * regla que la barbería nunca pidió.
 */

const PREFIX = 'appt';
const VERSION = 'v1';

/** Tope de citas listadas: una lista de WhatsApp admite 10 filas y una es "sacar otro". */
export const MAX_LISTED_APPOINTMENTS = 9;

export enum AppointmentAction {
  /** Abre las acciones de una cita concreta. */
  PICK = 'pick',
  RESCHEDULE = 'resched',
  /** Pide confirmación antes de cancelar. */
  CANCEL = 'cancel',
  CANCEL_CONFIRM = 'cancelok',
  /** Reserva adicional, sin tocar las que ya tiene. */
  NEW = 'new',
  /** Vuelve sin hacer nada. */
  DISMISS = 'dismiss',
}

export type AppointmentSelection = {
  action: AppointmentAction;
  /** Ausente en las acciones que no operan sobre una cita concreta. */
  appointmentId?: string;
};

export type AppointmentOption = {
  id: string;
  title: string;
  description?: string;
};

export type AppointmentPrompt = {
  body: string;
  options: AppointmentOption[];
};

/** Datos mínimos de una cita para poder mostrarla y operarla. */
export type AppointmentSummary = {
  id: string;
  serviceName: string;
  staffName: string | null;
  startTime: Date;
};

export function encodeAppointmentAction(
  action: AppointmentAction,
  appointmentId?: string,
): string {
  const parts = [PREFIX, VERSION, action];
  if (appointmentId) parts.push(appointmentId);
  return parts.join('|');
}

export function decodeAppointmentAction(
  raw: string,
): AppointmentSelection | null {
  const parts = raw.split('|');
  if (parts.length < 3 || parts.length > 4) return null;

  const [prefix, version, action, appointmentId] = parts;
  if (prefix !== PREFIX || version !== VERSION) return null;
  if (!isAppointmentAction(action)) return null;

  return { action, appointmentId: appointmentId || undefined };
}

export function isAppointmentSelection(raw: string): boolean {
  return raw.startsWith(`${PREFIX}|`);
}

/**
 * Cita única: se saltea el paso de elegir cuál, igual que se saltea el paso de
 * profesional cuando hay uno solo.
 */
export function buildSingleAppointmentPrompt(
  appointment: AppointmentSummary,
  timezone: string,
): AppointmentPrompt {
  return {
    body: `Ya tenés un turno:\n\n${describeAppointment(appointment, timezone)}\n\n¿Qué querés hacer?`,
    options: [
      {
        id: encodeAppointmentAction(
          AppointmentAction.RESCHEDULE,
          appointment.id,
        ),
        title: 'Reagendar',
      },
      {
        id: encodeAppointmentAction(AppointmentAction.CANCEL, appointment.id),
        title: 'Cancelar turno',
      },
      {
        id: encodeAppointmentAction(AppointmentAction.NEW),
        title: 'Sacar otro',
      },
    ],
  };
}

/** Varias citas: primero se elige cuál, después qué hacer con ella. */
export function buildAppointmentListPrompt(
  appointments: AppointmentSummary[],
  timezone: string,
): AppointmentPrompt {
  const listed = appointments.slice(0, MAX_LISTED_APPOINTMENTS);

  return {
    body:
      listed.length < appointments.length
        ? `Tenés ${appointments.length} turnos. Estos son los más próximos:`
        : 'Ya tenés turnos agendados. ¿Cuál querés modificar?',
    options: [
      ...listed.map((appointment) => ({
        id: encodeAppointmentAction(AppointmentAction.PICK, appointment.id),
        title: formatDateTime(appointment.startTime, timezone),
        description: describeServiceAndStaff(appointment),
      })),
      {
        id: encodeAppointmentAction(AppointmentAction.NEW),
        title: 'Sacar otro turno',
      },
    ],
  };
}

/**
 * Confirmación antes de cancelar.
 *
 * Cancelar es destructivo y además le libera el horario a otro cliente, así que
 * no puede quedar a un solo toque de distancia.
 */
export function buildCancelConfirmPrompt(
  appointment: AppointmentSummary,
  timezone: string,
): AppointmentPrompt {
  return {
    body: `¿Seguro que querés cancelar este turno?\n\n${describeAppointment(appointment, timezone)}`,
    options: [
      {
        id: encodeAppointmentAction(
          AppointmentAction.CANCEL_CONFIRM,
          appointment.id,
        ),
        title: 'Sí, cancelar',
      },
      {
        id: encodeAppointmentAction(AppointmentAction.DISMISS),
        title: 'No, dejarlo',
      },
    ],
  };
}

export function buildCancelledText(
  appointment: AppointmentSummary,
  timezone: string,
): string {
  return `Cancelé tu turno del ${formatDateTime(appointment.startTime, timezone)}. Si querés otro, escribime "reservar".`;
}

export function buildDismissedText(): string {
  return 'Listo, no toqué nada. Tu turno sigue en pie.';
}

export function buildAppointmentGoneText(): string {
  return 'No encontré ese turno. Puede que ya se haya cancelado. Escribime "reservar" si querés sacar uno nuevo.';
}

// ---------------------------------------------------------------------------

function describeAppointment(
  appointment: AppointmentSummary,
  timezone: string,
): string {
  const lines = [
    appointment.serviceName,
    formatDateTime(appointment.startTime, timezone),
  ];

  if (appointment.staffName) lines.push(`Con ${appointment.staffName}`);

  return lines.join('\n');
}

function describeServiceAndStaff(appointment: AppointmentSummary): string {
  return appointment.staffName
    ? `${appointment.serviceName} · ${appointment.staffName}`
    : appointment.serviceName;
}

/** "vie 21 ago, 15:00", que entra en el título de una fila de lista. */
function formatDateTime(startTime: Date, timezone: string): string {
  const date = new Intl.DateTimeFormat('es-AR', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
    .format(startTime)
    .replace(/\./g, '');

  const time = new Intl.DateTimeFormat('es-AR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(startTime);

  return `${date}, ${time}`;
}

function isAppointmentAction(value: string): value is AppointmentAction {
  return (Object.values(AppointmentAction) as string[]).includes(value);
}
