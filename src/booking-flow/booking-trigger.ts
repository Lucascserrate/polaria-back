/**
 * Detección de la intención de reservar.
 *
 * **Es un recurso provisional.** El rol definitivo de la IA es justamente este
 * —entender qué quiere el usuario y arrancar el flujo—, así que esta función se
 * reemplaza por el router de intención cuando se recorte el asistente. Hasta
 * entonces conviene que sea explícita, determinista y testeable, y no reutilizar
 * la lista de palabras del pipeline viejo: esa incluye "horario" y
 * "disponibilidad", con lo cual una pregunta como "¿cuál es el horario de
 * atención?" abriría una reserva en vez de responderse.
 *
 * Criterio: preferir no disparar. Un mensaje ambiguo que sigue hacia la IA es un
 * error recuperable; abrir una reserva que el cliente no pidió congela la
 * conversación y lo obliga a cancelar.
 */

/** Pide un turno de forma inequívoca. */
const BOOKING_KEYWORDS = [
  'agendar',
  'agendame',
  'agéndame',
  'reservar',
  'reservame',
  'resérvame',
  'reserva',
  'turno',
  'turnos',
  'cita',
  'citas',
  'sacar hora',
  'pedir hora',
];

/**
 * Palabras que hablan de una reserva **existente**.
 *
 * Sin este freno, "quiero cancelar mi turno" abriría una reserva nueva, porque
 * contiene "turno". Cancelar y reprogramar son flujos distintos que todavía no
 * existen; hasta que existan, estos mensajes van a la IA.
 */
const EXISTING_BOOKING_KEYWORDS = [
  'cancelar',
  'cancela',
  'anular',
  'anula',
  'mover',
  'cambiar',
  'reprogramar',
  'reagendar',
  'posponer',
];

export function detectBookingTrigger(messageText: string): boolean {
  const normalized = normalize(messageText);
  if (normalized.length === 0) return false;

  if (containsAny(normalized, EXISTING_BOOKING_KEYWORDS)) return false;

  return containsAny(normalized, BOOKING_KEYWORDS);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAny(normalized: string, keywords: string[]): boolean {
  return keywords.some((keyword) => normalized.includes(normalize(keyword)));
}
