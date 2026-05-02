import type { AssistantEntities } from '../types/assistant-entities.type';
import type { AssistantParsedResponse } from '../utils/assistant-response-parser';
import { mergeEntities } from './assistant-entities-merge';

export type NormalizeAssistantEntitiesParams = {
  incoming: AssistantParsedResponse['entities'] | undefined;
  stored: Partial<AssistantEntities> | undefined;
  timezone: string;
  now?: Date;
};

const getTodayISODateInTimeZone = (timeZone: string, now: Date): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
};

export const normalizeAssistantEntities = (
  params: NormalizeAssistantEntitiesParams,
): AssistantEntities => {
  const { incoming, stored, timezone, now = new Date() } = params;

  const merged: AssistantEntities = mergeEntities(stored, incoming);

  if (!merged.staff || merged.staff.trim().length === 0) {
    merged.staff = 'sin preferencia';
  }

  if (!merged.date || merged.date.trim().length === 0) {
    merged.date = getTodayISODateInTimeZone(timezone, now);
  }

  return merged;
};
