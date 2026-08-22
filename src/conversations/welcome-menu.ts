/**
 * Menú de bienvenida.
 *
 * Es la puerta de entrada cuando el cliente escribe algo que no es un pedido
 * explícito de turno. Define el alcance de Polaria de forma honesta: puede
 * agendar, o puede apartarse para que atienda una persona. No finge responder
 * cualquier cosa.
 *
 * Los ids son literales estables y **no** pasan por el codec de reservas: no hay
 * sesión a la que atarlos, y el codec existe para atar una respuesta a un paso
 * concreto de un flujo. El prefijo distinto es justamente lo que permite al
 * coordinador saber a quién despachar cada respuesta interactiva.
 */

import {
  addDaysToIsoDate,
  formatTimeLabel,
  todayIsoDateIn,
} from '../booking-flow/utils/booking-date.util';

const MENU_PREFIX = 'menu';
const MENU_VERSION = 'v1';

export enum WelcomeMenuAction {
  /** Inicia el flujo guiado de reserva. */
  BOOK = 'book',
  /** Abre las acciones sobre el turno que el cliente ya tiene. */
  MANAGE = 'manage',
  /** Transfiere la conversación a una persona del negocio. */
  TALK_TO_HUMAN = 'human',
}

export type WelcomeMenuOption = {
  id: string;
  title: string;
};

/** `menu|v1|book`. Nunca colisiona con un payload de reserva, que abre con `b1|`. */
export function encodeMenuAction(action: WelcomeMenuAction): string {
  return [MENU_PREFIX, MENU_VERSION, action].join('|');
}

export function decodeMenuAction(raw: string): WelcomeMenuAction | null {
  const parts = raw.split('|');
  if (parts.length !== 3) return null;

  const [prefix, version, action] = parts;
  if (prefix !== MENU_PREFIX || version !== MENU_VERSION) return null;

  return isWelcomeMenuAction(action) ? action : null;
}

export function isMenuSelection(raw: string): boolean {
  return raw.startsWith(`${MENU_PREFIX}|`);
}

/**
 * Texto y opciones del menú.
 *
 * El título de botón admite 20 caracteres, así que las etiquetas se mantienen
 * cortas a propósito.
 */
export function buildWelcomeMenu(businessName: string): {
  body: string;
  options: WelcomeMenuOption[];
} {
  return {
    body: `¡Hola! 👋 Soy el asistente de ${businessName}. ¿En qué puedo ayudarte?`,
    options: [
      {
        id: encodeMenuAction(WelcomeMenuAction.BOOK),
        title: 'Agendar una cita',
      },
      {
        id: encodeMenuAction(WelcomeMenuAction.TALK_TO_HUMAN),
        title: 'Hablar con alguien',
      },
    ],
  };
}

/**
 * Cómo se nombra el turno en el saludo: "hoy a las 18:00 con Lucas".
 *
 * Relativo cuando se puede —hoy, mañana— porque es como lo diría una persona y
 * es lo que el cliente necesita para ubicarse. Más allá de mañana se dice el día
 * concreto, que a esa distancia informa más que "en tres días".
 *
 * El día se compara en la zona del negocio: a las 21:00 en Bolivia ya es mañana
 * en UTC, y un turno de esta tarde no puede anunciarse como si fuera de mañana.
 */
export function describeUpcomingAppointment(input: {
  startTime: Date;
  staffName?: string | null;
  timeZone: string;
  now?: Date;
}): string {
  const { startTime, staffName, timeZone } = input;
  const now = input.now ?? new Date();

  const today = todayIsoDateIn(timeZone, now);
  const day = todayIsoDateIn(timeZone, startTime);

  const time = formatTimeLabel(startTime, timeZone);

  const when =
    day === today
      ? `hoy a las ${time}`
      : day === addDaysToIsoDate(today, 1)
        ? `mañana a las ${time}`
        : `el ${formatLongDay(startTime, timeZone)} a las ${time}`;

  return staffName ? `${when} con ${staffName}` : when;
}

/**
 * Menú para quien ya tiene un turno.
 *
 * Reemplaza a la bienvenida genérica en ese caso. Volver a presentarse —"soy el
 * asistente, ¿en qué puedo ayudarte?"— justo después de que el cliente reservó
 * se lee como que el bot se olvidó de lo que acaba de pasar, y lo primero que la
 * persona quiere resolver casi siempre es *ese* turno.
 *
 * El turno se nombra en el cuerpo y no en las opciones: los títulos de botón
 * admiten 20 caracteres y la fecha no entra.
 */
export function buildBookedMenu(appointmentLabel: string): {
  body: string;
  options: WelcomeMenuOption[];
} {
  return {
    body: `Tenés un turno agendado para ${appointmentLabel}. ¿Qué querés hacer?`,
    options: [
      {
        id: encodeMenuAction(WelcomeMenuAction.MANAGE),
        title: 'Gestionar mi turno',
      },
      {
        id: encodeMenuAction(WelcomeMenuAction.BOOK),
        title: 'Sacar otro turno',
      },
      {
        id: encodeMenuAction(WelcomeMenuAction.TALK_TO_HUMAN),
        title: 'Hablar con alguien',
      },
    ],
  };
}

/** Marca con la que el menú queda identificado en `messages.rawJson.source`. */
export const WELCOME_MENU_SOURCE = 'welcome-menu';

/**
 * Ventana durante la cual no se reenvía el menú.
 *
 * Sin esto, tres mensajes seguidos sin intención detectada producen tres menús
 * idénticos, que se lee como un bot roto. Media hora es suficiente para cubrir
 * una ráfaga de mensajes y lo bastante corta para que el menú vuelva a aparecer
 * si el cliente retoma la conversación más tarde.
 */
export const WELCOME_MENU_COOLDOWN_MINUTES = 30;

/**
 * Decide si corresponde mandar el menú.
 *
 * Se apoya en el último mensaje saliente registrado: si ya fue un menú y es
 * reciente, se calla. No hace falta estado nuevo porque el historial ya guarda el
 * origen de cada mensaje.
 */
export function shouldSendWelcomeMenu(params: {
  lastOutgoingSource?: string | null;
  lastOutgoingAt?: Date | null;
  now: Date;
}): boolean {
  const { lastOutgoingSource, lastOutgoingAt, now } = params;

  if (lastOutgoingSource !== WELCOME_MENU_SOURCE || !lastOutgoingAt) {
    return true;
  }

  const elapsedMinutes =
    (now.getTime() - lastOutgoingAt.getTime()) / (60 * 1000);

  return elapsedMinutes >= WELCOME_MENU_COOLDOWN_MINUTES;
}

/** Confirmación de que Polaria se apartó de la conversación. */
export function buildHandoffAcknowledgement(): string {
  return 'Listo, le aviso al equipo. En un rato te responde una persona por acá.';
}

function isWelcomeMenuAction(value: string): value is WelcomeMenuAction {
  return (Object.values(WelcomeMenuAction) as string[]).includes(value);
}

/**
 * "viernes 28 de agosto", para meter en una frase.
 *
 * No se reusa `formatDateLabel` —"vie, 28 ago"— porque esa etiqueta está pensada
 * para la fila de una lista, donde el ancho manda. Acá el texto se lee corrido y
 * la abreviatura con coma queda partida.
 */
function formatLongDay(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
    .format(instant)
    .replace(',', '');
}
