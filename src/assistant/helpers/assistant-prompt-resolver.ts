import type { Conversation } from '../../conversations/entities/conversation.entity';
import type { AssistantPromptContext } from '../prompts/assistant.system';
import type { AssistantEntities } from '../types/assistant-entities.type';
import {
  AssistantIntent,
  AssistantIntentEntities,
} from '../intents/assistant-intent';
import { AssistantAction } from '../core/assistant-actions';
import { decideNextAction } from '../core/assistant-orchestrator';
import { buildGreetingPromptAddon } from '../prompts/greeting.prompt';
import { buildBookingPromptAddon } from '../prompts/booking.prompt';
import { buildServicesPromptAddon } from '../prompts/services.prompt';
import { buildBusinessHoursPromptAddon } from '../prompts/business-hours.prompt';
import { buildOfftopicPromptAddon } from '../prompts/offtopic.prompt';

const parseTimeToMinutes = (raw: string): number | null => {
  const match = raw.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const parseBusinessHoursForDay = (
  businessHours: string[],
  dayOfWeek: number,
): { startMinutes: number; endMinutes: number } | null => {
  const targetPrefix = `dia ${dayOfWeek}:`;
  const line = businessHours.find((item) =>
    item.toLowerCase().trim().startsWith(targetPrefix),
  );
  if (!line) return null;

  const match = line.match(/:\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
  if (!match) return null;

  const start = parseTimeToMinutes(match[1]);
  const end = parseTimeToMinutes(match[2]);
  if (start === null || end === null) return null;
  return { startMinutes: start, endMinutes: end };
};

const getIsoDayOfWeek = (isoDate: string): number | null => {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (Number.isNaN(date.getTime())) return null;
  return date.getUTCDay();
};

export const resolvePromptForIntent = (params: {
  routerResult: { intent: AssistantIntent; entities: AssistantIntentEntities };
  promptContext: AssistantPromptContext;
  conversation: Pick<Conversation, 'contextJson' | 'currentState'>;
  messageText: string;
}) => {
  const { routerResult, promptContext, conversation, messageText } = params;
  const currentMinutes = parseTimeToMinutes(promptContext.currentTime);
  const currentDayOfWeek = getIsoDayOfWeek(promptContext.currentDate);
  const currentSchedule =
    currentDayOfWeek !== null
      ? parseBusinessHoursForDay(promptContext.businessHours, currentDayOfWeek)
      : null;
  const businessStatus: 'OPEN' | 'CLOSED' =
    currentMinutes !== null &&
    currentSchedule !== null &&
    currentMinutes >= currentSchedule.endMinutes
      ? 'CLOSED'
      : 'OPEN';

  const inferServiceFromText = (text: string): string[] | null => {
    const normalizedText = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

    const wantsHaircut =
      /\bcorte\b/.test(normalizedText) ||
      /\bcorte\s+de\s+(cabello|pelo)\b/.test(normalizedText);
    if (!wantsHaircut) return null;

    const normalizedServices = promptContext.services.map((service) => ({
      raw: service,
      normalized: service
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim(),
    }));

    const exactCorte = normalizedServices.find((s) => s.normalized === 'corte');
    if (exactCorte) return [exactCorte.raw];

    const containsCorte = normalizedServices.find((s) =>
      s.normalized.includes('corte'),
    );
    return containsCorte ? [containsCorte.raw] : null;
  };

  const inferStaffFromText = (text: string): string | null => {
    const normalized = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const noPreferencePatterns = [
      'no',
      'sin preferencia',
      'sin preferencias',
      'no tengo preferencia',
      'no tengo preferencias',
      'no hay preferencia',
      'cualquiera',
      'me da igual',
      'indiferente',
      'no importa',
    ];

    return noPreferencePatterns.some((p) =>
      p === 'no'
        ? normalized === 'no' ||
          normalized.startsWith('no ') ||
          normalized.endsWith(' no') ||
          /\bno\b/.test(normalized)
        : normalized.includes(p),
    )
      ? 'sin preferencia'
      : null;
  };

  const storedEntities =
    (conversation.contextJson?.entities as Partial<AssistantIntentEntities>) ??
    {};
  const lastBookedEntities =
    (conversation.contextJson?.lastBookedEntities as
      | Partial<AssistantIntentEntities>
      | undefined) ?? undefined;

  const inferredServices =
    routerResult.entities.services ??
    storedEntities.services ??
    lastBookedEntities?.services ??
    inferServiceFromText(messageText);

  const mergedBookingEntities: AssistantIntentEntities = {
    services: inferredServices ?? null,
    staff:
      routerResult.entities.staff ??
      storedEntities.staff ??
      inferStaffFromText(messageText) ??
      null,
    date: routerResult.entities.date ?? storedEntities.date ?? null,
    time: routerResult.entities.time ?? storedEntities.time ?? null,
  };

  switch (routerResult.intent) {
    case AssistantIntent.GREETING:
      return buildGreetingPromptAddon({
        businessName: promptContext.barbershopName,
        services: promptContext.services,
        businessHours: promptContext.businessHours,
        currentDate: promptContext.currentDate,
        currentTime: promptContext.currentTime,
        businessStatus,
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
    case AssistantIntent.BOOKING:
    case AssistantIntent.SHOW_HOURS:
    case AssistantIntent.CONFIRM_BOOKING: {
      const bookingEntities: AssistantEntities = {
        services: mergedBookingEntities.services ?? null,
        staff: mergedBookingEntities.staff ?? null,
        date: mergedBookingEntities.date ?? null,
        time: mergedBookingEntities.time ?? null,
      };

      const proposedBookingAction: AssistantAction =
        routerResult.intent === AssistantIntent.CONFIRM_BOOKING
          ? AssistantAction.CONFIRM_BOOKING
          : !bookingEntities.services?.length
            ? AssistantAction.ASK_SERVICE
            : !bookingEntities.date
              ? AssistantAction.ASK_DATE
              : !bookingEntities.staff
                ? AssistantAction.ASK_STAFF
                : !bookingEntities.time
                  ? AssistantAction.SHOW_HOURS
                  : AssistantAction.CONFIRM_BOOKING;

      const nextBookingAction =
        decideNextAction({
          entities: bookingEntities,
          proposedAction: proposedBookingAction,
          conversationState: conversation.currentState,
        }) ?? proposedBookingAction;

      return buildBookingPromptAddon({
        action: nextBookingAction,
        entities: bookingEntities,
        services: promptContext.services,
        businessHours: promptContext.businessHours,
        staffNames: Object.keys(promptContext.staffServices),
      });
    }
    case AssistantIntent.OFF_TOPIC:
    default:
      return buildOfftopicPromptAddon();
  }
};
