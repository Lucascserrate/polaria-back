import type { AssistantEntities } from '../types/assistant-entities.type';
import type { AssistantParsedResponse } from '../utils/assistant-response-parser';

export const mergeEntities = (
  prev: Partial<AssistantEntities> | undefined,
  next: AssistantParsedResponse['entities'] | undefined,
): AssistantEntities => {
  const prevEntities: Partial<AssistantEntities> = prev ?? {};

  const pick = <T>(
    prevValue: T | null | undefined,
    nextValue: T | null | undefined,
  ): T | null => {
    if (nextValue !== null && nextValue !== undefined) return nextValue;
    return prevValue ?? null;
  };

  return {
    services: pick(prevEntities.services, next?.services),
    staff: pick(prevEntities.staff, next?.staff),
    date: pick(prevEntities.date, next?.date),
    time: pick(prevEntities.time, next?.time),
  };
};

