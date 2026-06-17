import { AssistantAction } from '../core/assistant-actions';
import type { AssistantEntities } from '../types/assistant-entities.type';
import {
  AssistantIntent,
  AssistantIntentEntities,
} from '../intents/assistant-intent';

export const fallbackActionForIntent = (intent: AssistantIntent) => {
  switch (intent) {
    case AssistantIntent.SHOW_HOURS:
      return AssistantAction.SHOW_HOURS;
    case AssistantIntent.SUMMARY:
      return AssistantAction.RESUMEN;
    case AssistantIntent.CONFIRM_BOOKING:
      return AssistantAction.CONFIRM_BOOKING;
    default:
      return undefined;
  }
};

export const mergeParsedWithRouter = (params: {
  parsed: {
    reply: string;
    entities?: {
      services?: string[] | null;
      staff?: string | null;
      date?: string | null;
      time?: string | null;
    };
    action?: string;
  };
  routerEntities: AssistantIntentEntities;
  intent: AssistantIntent;
}) => {
  const mergedEntities: AssistantEntities = {
    services:
      params.parsed.entities?.services ??
      params.routerEntities.services ??
      null,
    staff: params.parsed.entities?.staff ?? params.routerEntities.staff ?? null,
    date: params.parsed.entities?.date ?? params.routerEntities.date ?? null,
    time: params.parsed.entities?.time ?? params.routerEntities.time ?? null,
  };

  return {
    ...params.parsed,
    entities: mergedEntities,
    action: params.parsed.action ?? fallbackActionForIntent(params.intent),
  };
};
