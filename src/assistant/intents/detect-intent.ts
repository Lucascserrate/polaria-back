import { UserIntent } from './user-intent';

export type DetectIntentInput = {
  messageText: string;
};

const normalizeText = (value: string): string => {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const BOOKING_KEYWORDS = [
  'agendar',
  'agenda',
  'reservar',
  'reserva',
  'cita',
  'turno',
  'apart',
  'horario',
  'disponibilidad',
];

const GREETING_PHRASES = [
  'hola',
  'buenas',
  'buenos dias',
  'buenas tardes',
  'buenas noches',
  'hey',
  'hello',
  'que tal',
  'como estan',
  'como estas',
  'hola una pregunta',
  'buen dia',
];

const isLikelyGreetingOnly = (normalized: string): boolean => {
  if (normalized.length === 0) return false;
  if (normalized.length <= 32 && GREETING_PHRASES.includes(normalized)) {
    return true;
  }

  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length <= 5) {
    const greetingsTokenSet = new Set([
      'hola',
      'buenas',
      'hey',
      'hello',
      'que',
      'tal',
      'como',
      'estan',
      'estas',
      'una',
      'pregunta',
      'dia',
      'buenos',
      'dias',
      'tardes',
      'noches',
    ]);
    const allAreGreetingish = tokens.every((t) => greetingsTokenSet.has(t));
    return allAreGreetingish;
  }

  return false;
};

const containsAny = (normalized: string, keywords: string[]): boolean => {
  return keywords.some((kw) => normalized.includes(kw));
};

export const detectIntent = (input: DetectIntentInput): UserIntent => {
  const normalized = normalizeText(input.messageText);

  const hasBookingKeyword = containsAny(normalized, BOOKING_KEYWORDS);
  if (hasBookingKeyword) {
    return UserIntent.BOOKING_INTENT;
  }

  if (isLikelyGreetingOnly(normalized)) {
    return UserIntent.GREETING;
  }

  return UserIntent.UNKNOWN;
};
