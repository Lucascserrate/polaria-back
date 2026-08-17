/**
 * Construcción de las respuestas del endpoint de Flows.
 *
 * Espeja `booking-flow.json`: si acá falta un campo que la pantalla declara, Meta
 * lo descarta y la pantalla se rompe de formas difíciles de diagnosticar. Por eso
 * los constructores exigen **todos** los campos, incluso los vacíos, en vez de
 * armarlos con spreads opcionales.
 */

/** Debe repetirse en cada respuesta o el Flow falla en silencio con datos vacíos. */
export const FLOW_DATA_API_VERSION = '3.0';

export const FLOW_SCREENS = {
  BOOKING: 'BOOKING',
  SUMMARY: 'SUMMARY',
  /** Pantalla reservada por Meta para cerrar el Flow. */
  SUCCESS: 'SUCCESS',
} as const;

/** Valor con el que el cliente pide que le asignemos cualquier profesional. */
export const ANY_STAFF = 'any';

export type FlowOption = {
  id: string;
  title: string;
  /** `false` muestra la opción en gris: comunica "ocupado" mejor que esconderla. */
  enabled?: boolean;
};

export type FlowResponse = {
  version: string;
  screen: string;
  data: Record<string, unknown>;
};

export type BookingScreenData = {
  services: FlowOption[];
  staff: FlowOption[];
  isStaffEnabled: boolean;
  dates: FlowOption[];
  isDateEnabled: boolean;
  slots: FlowOption[];
  isSlotEnabled: boolean;
  errorMessage?: string;
};

/** Pantalla de selección, con los cuatro desplegables en cascada. */
export function buildBookingScreen(data: BookingScreenData): FlowResponse {
  return {
    version: FLOW_DATA_API_VERSION,
    screen: FLOW_SCREENS.BOOKING,
    data: {
      services: data.services,
      staff: data.staff,
      is_staff_enabled: data.isStaffEnabled,
      dates: data.dates,
      is_date_enabled: data.isDateEnabled,
      slots: data.slots,
      is_slot_enabled: data.isSlotEnabled,
      has_error: Boolean(data.errorMessage),
      error_message: data.errorMessage ?? '',
    },
  };
}

export type SummaryScreenData = {
  summary: string;
  service: string;
  staff: string;
  date: string;
  slot: string;
};

/**
 * Pantalla de revisión.
 *
 * Arrastra las cuatro selecciones porque su pie las devuelve al confirmar: el
 * cliente ya no puede cambiarlas, pero el servidor las revalida igual antes de
 * crear nada.
 */
export function buildSummaryScreen(data: SummaryScreenData): FlowResponse {
  return {
    version: FLOW_DATA_API_VERSION,
    screen: FLOW_SCREENS.SUMMARY,
    data: {
      summary: data.summary,
      service: data.service,
      staff: data.staff,
      date: data.date,
      slot: data.slot,
    },
  };
}

/**
 * Cierre del Flow.
 *
 * Lo que va en `params` es lo que vuelve al chat dentro del `nfm_reply`, así que
 * es la única forma de enterarse del desenlace desde el webhook.
 */
export function buildTerminalResponse(
  flowToken: string,
  params: Record<string, unknown>,
): FlowResponse {
  return {
    version: FLOW_DATA_API_VERSION,
    screen: FLOW_SCREENS.SUCCESS,
    data: {
      extension_message_response: {
        params: { flow_token: flowToken, ...params },
      },
    },
  };
}

/** Respuesta al health check de Meta. */
export function buildPingResponse(): FlowResponse {
  return {
    version: FLOW_DATA_API_VERSION,
    screen: '',
    data: { status: 'active' },
  };
}

/**
 * Pantalla de selección vacía, con todo apagado salvo los servicios.
 *
 * Es el estado inicial y también el de cualquier error temprano: mostrar la
 * pantalla con un mensaje es preferible a cerrar el Flow de golpe.
 */
export function emptyBookingScreen(
  services: FlowOption[],
  errorMessage?: string,
): FlowResponse {
  return buildBookingScreen({
    services,
    staff: [],
    isStaffEnabled: false,
    dates: [],
    isDateEnabled: false,
    slots: [],
    isSlotEnabled: false,
    errorMessage,
  });
}
