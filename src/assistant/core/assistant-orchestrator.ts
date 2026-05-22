import type { AssistantEntities } from '../types/assistant-entities.type';
import { AssistantAction, isAssistantAction } from './assistant-actions';

export const decideNextAction = (params: {
  entities: AssistantEntities;
  proposedAction: unknown;
  conversationState?: string;
}): AssistantAction | undefined => {
  const { entities, proposedAction, conversationState } = params;

  const hasService = Boolean(entities.services && entities.services.length > 0);
  const hasDate = Boolean(entities.date && entities.date.trim().length > 0);
  const hasTime = Boolean(entities.time && entities.time.trim().length > 0);

  const proposed = isAssistantAction(proposedAction)
    ? proposedAction
    : undefined;

  if (!proposed) return undefined;

  if (!hasService && proposed !== AssistantAction.ASK_SERVICE) {
    return AssistantAction.ASK_SERVICE;
  }

  if (proposed === AssistantAction.CONFIRM_BOOKING) {
    if (conversationState === 'CONFIRM_APPOINTMENT' && hasDate && hasTime) {
      return AssistantAction.CONFIRM_BOOKING;
    }
    return AssistantAction.RESUMEN;
  }

  if (proposed === AssistantAction.RESUMEN) {
    if (hasDate && hasTime) return AssistantAction.RESUMEN;
    return AssistantAction.SHOW_HOURS;
  }

  if (proposed === AssistantAction.SHOW_HOURS) {
    if (hasService && hasDate) return AssistantAction.SHOW_HOURS;
    return AssistantAction.ASK_SERVICE;
  }

  return proposed;
};
