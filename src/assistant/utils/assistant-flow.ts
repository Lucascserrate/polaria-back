import type { AssistantParsedResponse } from './assistant-response-parser';
import type { AssistantEntities } from '../types/assistant-entities.type';
import type { Conversation } from '../../conversations/entities/conversation.entity';

export const clearEntities = (
  existing?: Partial<AssistantEntities>,
): AssistantEntities => ({
  ...(existing ?? {}),
  services: null,
  staff: null,
  date: null,
  time: null,
});

export const mergeIncomingWithStored = (
  incoming: AssistantParsedResponse['entities'] | undefined,
  stored: Partial<AssistantEntities>,
): AssistantParsedResponse['entities'] => {
  const preferStored = <T>(
    incomingValue: T | null | undefined,
    storedValue: T | null | undefined,
  ): T | null => {
    if (incomingValue !== null && incomingValue !== undefined) {
      return incomingValue;
    }
    return storedValue ?? null;
  };
  return {
    services: preferStored(incoming?.services, stored.services),
    staff: preferStored(incoming?.staff, stored.staff),
    date: preferStored(incoming?.date, stored.date),
    time: preferStored(incoming?.time, stored.time),
  };
};

export const mergeEntitiesForStore = (
  next: AssistantParsedResponse['entities'] | undefined,
  prev: AssistantParsedResponse['entities'] | undefined,
  stored: Partial<AssistantEntities>,
): AssistantEntities => {
  const pickExisting = <T>(
    nextValue: T | null | undefined,
    prevValue: T | null | undefined,
    storedValue: T | null | undefined,
  ): T | null => {
    // Si el nuevo valor no es null, usarlo
    if (nextValue !== null && nextValue !== undefined) {
      return nextValue;
    }
    // Si el nuevo valor es null pero el anterior existe, mantener el anterior
    if (prevValue !== null && prevValue !== undefined) {
      return prevValue;
    }
    // Sino usar el almacenado
    return storedValue ?? null;
  };

  return {
    services: pickExisting(next?.services, prev?.services, stored.services),
    staff: pickExisting(next?.staff, prev?.staff, stored.staff),
    date: pickExisting(next?.date, prev?.date, stored.date),
    time: pickExisting(next?.time, prev?.time, stored.time),
  };
};

export const buildResetContext = (conversation: Conversation) => ({
  // Mantener solo metadata no relacionada con entidades
  appointmentCreated: false,
  lastAppointmentKey: undefined,
  hasAssistantIntroduced:
    conversation.contextJson?.hasAssistantIntroduced === true,
  // Limpiar completamente las entidades y contexto de booking
  entities: clearEntities(
    conversation.contextJson?.entities as
      | Partial<AssistantEntities>
      | undefined,
  ),
  // NO mantener el resto del contexto para evitar fechas/variables viejas
});
