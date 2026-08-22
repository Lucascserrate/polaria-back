import {
  AppointmentStatus,
  blocksAgenda,
} from '../appointments/entities/appointment.entity';

/**
 * Reglas del recordatorio de una cita. Todo acá es puro.
 *
 * Está separado del servicio a propósito: son las decisiones que hay que poder
 * razonar y probar sin base de datos ni relojes reales. El servicio decide
 * *cuándo* preguntar; esto responde *qué* corresponde.
 */

/**
 * Canal de entrega. Hoy solo WhatsApp, pero viaja en la clave única para que
 * agregar correo o SMS no obligue a migrar la tabla ni a tocar estas reglas.
 */
export const REMINDER_CHANNEL_WHATSAPP = 'whatsapp';

export enum ReminderState {
  /** Programado y esperando su momento. */
  SCHEDULED = 'SCHEDULED',
  /**
   * Tomado por una ejecución que está llamando al canal ahora mismo.
   *
   * Existe para separar "lo estoy mandando" de "llegó". Sin este paso había
   * que marcar `SENT` antes de llamar a Meta —para que dos ejecuciones no
   * enviaran lo mismo—, y una caída en el medio dejaba un recordatorio marcado
   * como enviado que nunca salió: el dueño leía "enviado" y el cliente no
   * había recibido nada.
   */
  SENDING = 'SENDING',
  /** Entregado al canal. Terminal: nunca se reenvía. */
  SENT = 'SENT',
  /** Ya no corresponde: la cita se canceló, se completó o se apagaron los avisos. */
  CANCELLED = 'CANCELLED',
  /** El canal rechazó el envío. */
  FAILED = 'FAILED',
  /** No se puede avisar por una condición de los datos, no por un fallo. */
  SKIPPED = 'SKIPPED',
}

/**
 * Estados desde los que ya no se vuelve.
 *
 * `SENT` es terminal porque un segundo recordatorio con el mismo canal y la
 * misma anticipación no es un recordatorio: es spam. `FAILED` lo es porque
 * reintentar sin control de intentos ni espera entre ellos convierte un error
 * transitorio en una tormenta.
 */
export const TERMINAL_REMINDER_STATES: readonly ReminderState[] = [
  ReminderState.SENT,
  ReminderState.FAILED,
];

/**
 * Estados que la reconciliación no toca.
 *
 * Los terminales por lo dicho arriba, y `SENDING` porque hay un envío en
 * curso: reescribir su horario o cancelarlo mientras alguien está hablando con
 * Meta produciría una fila que no describe lo que pasó.
 */
const FROZEN_REMINDER_STATES: readonly ReminderState[] = [
  ...TERMINAL_REMINDER_STATES,
  ReminderState.SENDING,
];

/** Por qué no hay recordatorio. Se guarda para poder explicarlo. */
export const REMINDER_REASONS = {
  /**
   * Esta anticipación ya no está configurada.
   *
   * Cubre los dos casos que llevan al mismo lugar: el negocio apagó todos los
   * avisos, o apagó justo el de esta anticipación y dejó otro encendido.
   */
  OFFSET_NOT_CONFIGURED: 'OFFSET_NOT_CONFIGURED',
  /** La cita se canceló o ya se atendió. */
  APPOINTMENT_INACTIVE: 'APPOINTMENT_INACTIVE',
  /** El momento de avisar ya pasó, así que no hay nada que programar. */
  LEAD_TIME_PASSED: 'LEAD_TIME_PASSED',
  /** El cliente no tiene teléfono cargado: no hay a dónde escribir. */
  NO_CLIENT_PHONE: 'NO_CLIENT_PHONE',
  /** Anticipación mal configurada. Defensivo. */
  INVALID_LEAD: 'INVALID_LEAD',
} as const;

export type ReminderTarget =
  /** No debería existir ningún recordatorio para esta cita. */
  | { kind: 'NOT_NEEDED'; reason: string }
  /** Debería existir y salir en este momento. */
  | { kind: 'SCHEDULE'; scheduledFor: Date }
  /** Correspondería avisar, pero no se puede. Se registra el motivo. */
  | { kind: 'SKIP'; reason: string };

export type ReminderSnapshot = {
  appointment: {
    status: AppointmentStatus;
    startTime: Date;
    clientPhone: string | null;
  };
  /**
   * Anticipación de **este** recordatorio, en minutos.
   *
   * Antes venía del negocio, cuando había uno solo. Ahora el llamador itera las
   * anticipaciones configuradas y pregunta por cada una: la regla es la misma
   * para el aviso de 24 horas y para el de 1, y lo único que cambia es el número.
   */
  offsetMinutes: number;
  now: Date;
};

/**
 * Qué recordatorio le corresponde a una cita **ahora mismo**.
 *
 * Se calcula siempre desde el estado actual de la cita y no desde lo que se
 * decidió antes. Eso es lo que hace que un cambio de horario converja solo: la
 * respuesta cambia porque cambió `startTime`, sin que nadie tenga que acordarse
 * de invalidar nada.
 *
 * El momento es aritmética de instantes: `startTime` es absoluto, así que
 * restarle la anticipación da exactamente ese tiempo antes de la hora local de
 * la cita, sin convertir zonas horarias. La zona solo hace falta para redactar
 * el mensaje.
 */
export function resolveReminderTarget(input: ReminderSnapshot): ReminderTarget {
  const { appointment, offsetMinutes, now } = input;

  // Una cita cancelada o ya atendida no ocupa agenda y no se recuerda.
  if (!blocksAgenda(appointment.status)) {
    return {
      kind: 'NOT_NEEDED',
      reason: REMINDER_REASONS.APPOINTMENT_INACTIVE,
    };
  }

  if (offsetMinutes <= 0) {
    return { kind: 'NOT_NEEDED', reason: REMINDER_REASONS.INVALID_LEAD };
  }

  const scheduledFor = new Date(
    appointment.startTime.getTime() - offsetMinutes * 60_000,
  );

  /*
   * El momento de avisar se evalúa antes que el teléfono a propósito. Si ya
   * pasó, tener o no teléfono es indistinto: no se iba a enviar igual, y
   * `LEAD_TIME_PASSED` es la explicación verdadera. Al revés, un
   * `NO_CLIENT_PHONE` sobre una cita que empezó hace una hora manda a buscar un
   * dato que no habría cambiado nada.
   */
  if (scheduledFor <= now) {
    return { kind: 'SKIP', reason: REMINDER_REASONS.LEAD_TIME_PASSED };
  }

  if (!appointment.clientPhone?.trim()) {
    return { kind: 'SKIP', reason: REMINDER_REASONS.NO_CLIENT_PHONE };
  }

  return { kind: 'SCHEDULE', scheduledFor };
}

export type StoredReminder = {
  state: ReminderState;
  scheduledFor: Date | null;
};

export type ReminderAction =
  /** Nada que hacer: lo guardado ya coincide con lo que corresponde. */
  | { kind: 'NOOP' }
  | {
      kind: 'CREATE' | 'UPDATE';
      state: ReminderState;
      scheduledFor: Date | null;
      failureReason: string | null;
    };

/**
 * Qué hacer con lo que hay guardado para llegar a lo que corresponde.
 *
 * Es la otra mitad pura, y la que resuelve la reconciliación: comparar el
 * objetivo contra la fila existente en vez de reaccionar a cada escritura de la
 * cita. Un estado terminal frena todo, y de ahí sale la garantía de que un
 * recordatorio enviado no se vuelve a enviar.
 */
export function resolveReminderAction(
  target: ReminderTarget,
  stored: StoredReminder | null,
): ReminderAction {
  // Un estado congelado frena todo. Que la cita cambie después no habilita un
  // segundo mensaje: el cliente ya recibió uno, o hay uno saliendo.
  if (stored && FROZEN_REMINDER_STATES.includes(stored.state)) {
    return { kind: 'NOOP' };
  }

  const desired = toDesiredRow(target);
  const kind = stored ? 'UPDATE' : 'CREATE';

  if (!stored) {
    return { kind, ...desired };
  }

  const sameState = stored.state === desired.state;
  const sameMoment =
    stored.scheduledFor?.getTime() === desired.scheduledFor?.getTime() ||
    (stored.scheduledFor === null && desired.scheduledFor === null);

  return sameState && sameMoment ? { kind: 'NOOP' } : { kind, ...desired };
}

function toDesiredRow(target: ReminderTarget): {
  state: ReminderState;
  scheduledFor: Date | null;
  failureReason: string | null;
} {
  switch (target.kind) {
    case 'SCHEDULE':
      return {
        state: ReminderState.SCHEDULED,
        scheduledFor: target.scheduledFor,
        failureReason: null,
      };
    case 'SKIP':
      return {
        state: ReminderState.SKIPPED,
        scheduledFor: null,
        failureReason: target.reason,
      };
    case 'NOT_NEEDED':
      return {
        state: ReminderState.CANCELLED,
        scheduledFor: null,
        failureReason: target.reason,
      };
  }
}

/**
 * Cuál de los recordatorios de una cita mostrar en la agenda.
 *
 * Con dos avisos por cita hay que elegir uno, y lo útil es **el próximo
 * pendiente**: si el de 24 horas ya salió y el de 1 hora espera, lo que le
 * importa al negocio es el que falta. Si no queda ninguno pendiente, el último
 * enviado dice que el cliente ya fue avisado. Y si tampoco hubo envíos, se
 * muestra cualquiera de los que no salieron para poder explicar por qué.
 *
 * Puro y con la lista completa como entrada: la decisión no depende del orden en
 * que la base devuelva las filas.
 */
export function pickReminderToShow<
  T extends {
    state: ReminderState;
    scheduledFor: Date | null;
    sentAt: Date | null;
  },
>(reminders: T[]): T | null {
  if (reminders.length === 0) return null;

  const pending = reminders
    .filter(
      (reminder) =>
        reminder.state === ReminderState.SCHEDULED ||
        reminder.state === ReminderState.SENDING,
    )
    .sort(
      (a, b) =>
        (a.scheduledFor?.getTime() ?? 0) - (b.scheduledFor?.getTime() ?? 0),
    );

  if (pending.length > 0) return pending[0];

  const sent = reminders
    .filter((reminder) => reminder.state === ReminderState.SENT)
    .sort((a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0));

  return sent[0] ?? reminders[0];
}
