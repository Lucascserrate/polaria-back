import type { Conversation } from '../../conversations/entities/conversation.entity';
import type { AssistantPromptContext } from '../prompts/assistant.system';
import { AssistantIntent } from '../intents/assistant-intent';
import { buildGreetingPromptAddon } from '../prompts/greeting.prompt';
import { buildServicesPromptAddon } from '../prompts/services.prompt';
import { buildBusinessHoursPromptAddon } from '../prompts/business-hours.prompt';
import { buildOfftopicPromptAddon } from '../prompts/offtopic.prompt';

/**
 * Elige el prompt según la intención detectada.
 *
 * Ya no existe una rama de reserva: cuando la intención es reservar, el flujo
 * guiado toma el control y la IA no llega a redactar nada. Por eso desapareció
 * toda la inferencia de servicio y profesional a partir del texto, que era
 * justamente el mecanismo que este rediseño elimina.
 */
export const resolvePromptForIntent = (params: {
  intent: AssistantIntent;
  promptContext: AssistantPromptContext;
  conversation: Pick<Conversation, 'contextJson'>;
}): string => {
  const { intent, promptContext, conversation } = params;

  switch (intent) {
    case AssistantIntent.GREETING:
      return buildGreetingPromptAddon({
        businessName: promptContext.barbershopName,
        services: promptContext.services,
        businessHours: promptContext.businessHours,
        currentDate: promptContext.currentDate,
        currentTime: promptContext.currentTime,
        businessStatus: resolveBusinessStatus(promptContext),
        variant:
          conversation.contextJson?.hasAssistantIntroduced === true
            ? 'SHORT'
            : 'FULL',
      });

    case AssistantIntent.ASK_SERVICES:
      return buildServicesPromptAddon({
        services: promptContext.services,
        servicesCatalog: promptContext.servicesCatalog,
        businessName: promptContext.barbershopName,
      });

    case AssistantIntent.ASK_HOURS:
      return buildBusinessHoursPromptAddon({
        businessHours: promptContext.businessHours,
      });

    default:
      return buildOfftopicPromptAddon();
  }
};

function resolveBusinessStatus(
  promptContext: AssistantPromptContext,
): 'OPEN' | 'CLOSED' {
  const currentMinutes = parseTimeToMinutes(promptContext.currentTime);
  const dayOfWeek = getIsoDayOfWeek(promptContext.currentDate);
  const schedule =
    dayOfWeek !== null
      ? parseBusinessHoursForDay(promptContext.businessHours, dayOfWeek)
      : null;

  return currentMinutes !== null &&
    schedule !== null &&
    currentMinutes >= schedule.endMinutes
    ? 'CLOSED'
    : 'OPEN';
}

function parseTimeToMinutes(raw: string): number | null {
  const match = raw.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function parseBusinessHoursForDay(
  businessHours: string[],
  dayOfWeek: number,
): { startMinutes: number; endMinutes: number } | null {
  const line = businessHours.find((item) =>
    item.toLowerCase().trim().startsWith(`dia ${dayOfWeek}:`),
  );
  if (!line) return null;

  const match = line.match(/:\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
  if (!match) return null;

  const start = parseTimeToMinutes(match[1]);
  const end = parseTimeToMinutes(match[2]);
  if (start === null || end === null) return null;
  return { startMinutes: start, endMinutes: end };
}

function getIsoDayOfWeek(isoDate: string): number | null {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return Number.isNaN(date.getTime()) ? null : date.getUTCDay();
}
