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

const MENU_PREFIX = 'menu';
const MENU_VERSION = 'v1';

export enum WelcomeMenuAction {
  /** Inicia el flujo guiado de reserva. */
  BOOK = 'book',
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

/** Confirmación de que Polaria se apartó de la conversación. */
export function buildHandoffAcknowledgement(): string {
  return 'Listo, le aviso al equipo. En un rato te responde una persona por acá.';
}

function isWelcomeMenuAction(value: string): value is WelcomeMenuAction {
  return (Object.values(WelcomeMenuAction) as string[]).includes(value);
}
