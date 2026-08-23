/**
 * Modelo del flujo guiado de reservas, independiente del transporte.
 *
 * El flujo no interpreta texto: cada paso ofrece un conjunto cerrado de opciones
 * y cada opción viaja con su `selectionId` ya codificado. El renderizador (listas
 * nativas de WhatsApp, o un Flow) solo traduce estas estructuras a componentes;
 * nunca construye identificadores ni decide transiciones.
 */

/**
 * Pasos del flujo guiado.
 *
 * El recorrido optimiza el caso mayoritario, que en una barbería es reservar para
 * hoy: la sesión arranca con la fecha puesta en hoy y va directo al servicio. El
 * cliente solo ve un selector de fecha si pide "Ver otros días" desde el paso de
 * horarios, así que `ASK_DATE` es un desvío opcional y no un paso obligatorio.
 */
export enum BookingSessionState {
  ASK_SERVICE = 'ASK_SERVICE',
  ASK_STAFF = 'ASK_STAFF',
  ASK_SLOT = 'ASK_SLOT',
  /** Desvío desde `ASK_SLOT` cuando la fecha actual no sirve. */
  ASK_DATE = 'ASK_DATE',
  CONFIRM = 'CONFIRM',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export const TERMINAL_STATES: readonly BookingSessionState[] = [
  BookingSessionState.COMPLETED,
  BookingSessionState.CANCELLED,
  BookingSessionState.EXPIRED,
];

export function isTerminalState(state: BookingSessionState): boolean {
  return TERMINAL_STATES.includes(state);
}

/**
 * Distingue "eligió Sin preferencia" de "todavía no eligió".
 *
 * Sin este discriminador, un `staffId` nulo sería ambiguo y el backend tendría
 * que adivinar; exactamente lo que este rediseño busca eliminar.
 */
export enum StaffPreference {
  ANY = 'ANY',
  SPECIFIC = 'SPECIFIC',
}

/** Valores reservados que viajan en el `selectionId` en lugar de un uuid. */
export const RESERVED_VALUES = {
  ANY_STAFF: 'any',
  CONFIRM: 'confirm',
  CANCEL: 'cancel',
  /** Avanza a la página siguiente sin elegir nada. */
  MORE: 'more',
  /** Abre el selector de fecha desde el paso de horarios. */
  OTHER_DAYS: 'otherdays',
} as const;

/**
 * Capacidades del canal por el que se renderiza el flujo.
 *
 * Es lo único que el transporte le cuenta al flujo sobre sus límites. Una lista
 * nativa de WhatsApp pasa 10; un Dropdown de Flows puede omitirlo.
 */
export type BookingChannelLimits = {
  maxOptionsPerPrompt?: number;
};

/** Tiempo de inactividad tras el cual la sesión se considera abandonada. */
export const BOOKING_SESSION_TTL_MINUTES = 15;

/** Cuántos días ofrecer cuando el cliente elige "Otro día". */
export const BOOKING_DATE_HORIZON_DAYS = 14;

// ---------------------------------------------------------------------------
// Opciones que el renderizador convierte en filas o botones
// ---------------------------------------------------------------------------

export type BookingOption = {
  /** Identificador ya codificado. El renderizador lo copia tal cual. */
  selectionId: string;
  title: string;
  description?: string;
};

export type BookingSummary = {
  date: string;
  serviceName: string;
  serviceDurationMinutes: number;
  /** Nombre del profesional asignado, o `null` mientras es "Sin preferencia". */
  staffName: string | null;
  startTime: Date;
  endTime: Date;
  /** Zona del negocio: el renderizador necesita formatear la hora sin resolverla. */
  timezone: string;
};

// ---------------------------------------------------------------------------
// Prompts: qué hay que mostrarle al cliente
// ---------------------------------------------------------------------------

export type BookingPrompt =
  | { kind: 'ASK_DATE'; options: BookingOption[] }
  | { kind: 'ASK_SERVICE'; date: string; options: BookingOption[] }
  | { kind: 'ASK_STAFF'; options: BookingOption[] }
  /**
   * Horarios de una fecha. `hasSlots` en `false` significa que ese día se agotó:
   * las únicas opciones son "Ver otros días" y "Cancelar", y el texto cambia.
   */
  | {
      kind: 'ASK_SLOT';
      date: string;
      hasSlots: boolean;
      options: BookingOption[];
    }
  | { kind: 'CONFIRM'; summary: BookingSummary; options: BookingOption[] }
  | {
      kind: 'COMPLETED';
      summary: BookingSummary;
      appointmentId: string;
      /**
       * La reserva ya existía y se modificó, en lugar de crearse.
       *
       * Cambia el texto: decirle "tu turno quedó agendado" a alguien que acaba de
       * mover el suyo suena a que le agendaron un segundo.
       */
      edited?: boolean;
    }
  | { kind: 'CANCELLED' }
  | { kind: 'EXPIRED' }
  /** La interacción pertenece a una sesión vencida, ajena o a un paso anterior. */
  | { kind: 'STALE' }
  /** No hay ningún horario para lo pedido; incluye hasta dónde se llegó. */
  /**
   * No se puede seguir. **Cierra la sesión**: es un final, no un paso.
   *
   * `SETUP` significa que el negocio todavía no está configurado —sin servicios
   * activos, sin profesionales—, que es distinto de no tener cupo.
   */
  | { kind: 'NO_AVAILABILITY'; scope: 'SETUP' | 'SERVICE' | 'STAFF' }
  /** El horario elegido se ocupó entre que se mostró y se confirmó. */
  | { kind: 'SLOT_TAKEN'; date: string; options: BookingOption[] }
  /** Llegó texto libre con el flujo abierto: se recuerda y se reenvía el paso. */
  | { kind: 'FROZEN'; current: BookingPrompt }
  /** Entrega repetida del mismo webhook: no hay que responder nada. */
  | { kind: 'NONE' };

/** Prompts que representan un paso pendiente de respuesta del cliente. */
export type PendingBookingPrompt = Extract<
  BookingPrompt,
  {
    kind: 'ASK_DATE' | 'ASK_SERVICE' | 'ASK_STAFF' | 'ASK_SLOT' | 'CONFIRM';
  }
>;

/**
 * Indica si el prompt le ofrece al cliente alguna forma de continuar.
 *
 * Es la invariante que sostiene el flujo: **una sesión abierta nunca puede
 * quedar en un prompt sin opciones**. Si lo hiciera, la conversación queda
 * congelada —el texto libre no se interpreta— y sin botones que tocar, ni
 * siquiera "Cancelar". El cliente no tendría salida.
 */
export function hasOptions(prompt: BookingPrompt): boolean {
  return 'options' in prompt && prompt.options.length > 0;
}
