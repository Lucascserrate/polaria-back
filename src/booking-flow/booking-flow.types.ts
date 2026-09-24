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
 *
 * `ASK_CATEGORY` tampoco es obligatorio: aparece solo cuando el catálogo no entra
 * en una sola lista. Ver `planServiceStep`.
 */
export enum BookingSessionState {
  /** Desvío previo a `ASK_SERVICE` en catálogos que no entran en una lista. */
  ASK_CATEGORY = 'ASK_CATEGORY',
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

/**
 * Qué parte del catálogo está mirando el cliente.
 *
 * Existe por lo mismo que `StaffPreference`: sin ella, un `selectedCategoryId`
 * nulo sería ambiguo entre "eligió Otros servicios" y "no hubo paso de
 * categorías", y el paso siguiente tendría que adivinar si filtrar por los que no
 * tienen categoría o no filtrar nada.
 *
 * Ausente —la columna en `NULL`— es el tercer caso: el catálogo entra en una
 * lista y el paso de categorías no ocurrió.
 */
export enum CategorySelection {
  /** Una categoría concreta, en `selectedCategoryId`. */
  SPECIFIC = 'SPECIFIC',
  /** La fila "Otros servicios": los que no están en ninguna categoría. */
  UNCATEGORIZED = 'UNCATEGORIZED',
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
  /** La fila "Otros servicios" del paso de categorías. */
  UNCATEGORIZED: 'nocategory',
  /** Vuelve del paso de servicios al de categorías. */
  BACK: 'back',
  /** Vuelve de los horarios de un tramo a la lista de tramos. */
  ALL_TIMES: 'alltimes',
} as const;

/**
 * Prefijo del valor que identifica a un **tramo del día** en lugar de a un
 * horario concreto.
 *
 * Los dos viajan por el mismo paso y hay que poder distinguirlos: un horario es
 * un instante ISO, y un tramo son dos separados por `~`. El separador es `~` y
 * no `|` porque ése ya parte el payload; ver `encodeSelection`.
 */
export const SLOT_RANGE_PREFIX = 'range:';

/** El valor con el que viaja un tramo, listo para `encodeSelection`. */
export function encodeSlotRange(from: Date, to: Date): string {
  return `${SLOT_RANGE_PREFIX}${from.toISOString()}~${to.toISOString()}`;
}

/**
 * El tramo que viene en un valor, o `null` si ese valor no es un tramo.
 *
 * Devolver `null` en lugar de lanzar es lo que deja preguntarlo primero y tratar
 * al resto como un horario, que es el caso de siempre.
 */
export function decodeSlotRange(
  value: string,
): { from: Date; to: Date } | null {
  if (!value.startsWith(SLOT_RANGE_PREFIX)) return null;

  const [from, to] = value.slice(SLOT_RANGE_PREFIX.length).split('~');
  const range = { from: new Date(from), to: new Date(to) };

  return Number.isNaN(range.from.getTime()) || Number.isNaN(range.to.getTime())
    ? null
    : range;
}

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
  | { kind: 'ASK_CATEGORY'; options: BookingOption[] }
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
      /**
       * El tramo que se está mirando, con sus extremos ya escritos en la hora
       * del negocio.
       *
       * Ausente es la pantalla del día completo. Está para que el texto pueda
       * decir dónde está parado el cliente: las dos pantallas son el mismo paso
       * y con el mismo encabezado parecen la misma, como si el flujo no hubiera
       * entendido que eligió un rango.
       *
       * Ya formateado y no como instantes porque quien escribe el mensaje no
       * conoce la zona horaria del negocio, y no tiene por qué.
       */
      range?: { from: string; to: string };
      /**
       * Las filas no son horarios sino **ratos del día**, porque no entraban
       * todos en la pantalla.
       *
       * Cambia el texto del mensaje, y ahí está todo el peso: probado con gente,
       * los títulos de las secciones de una lista no se leen —viven dentro del
       * desplegable— y lo que se lee es esto, que aparece en el chat. Si el
       * cuerpo dice "estos son los horarios" y las filas dicen "09:00 a 10:30",
       * el cliente cierra la lista sin entender qué le ofrecieron.
       */
      grouped?: boolean;
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
    kind:
      | 'ASK_DATE'
      | 'ASK_CATEGORY'
      | 'ASK_SERVICE'
      | 'ASK_STAFF'
      | 'ASK_SLOT'
      | 'CONFIRM';
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
