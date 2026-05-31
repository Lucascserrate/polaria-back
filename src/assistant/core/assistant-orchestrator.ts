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
  const hasStaff = Boolean(
    entities.staff &&
    typeof entities.staff === 'string' &&
    entities.staff.trim().length > 0,
  );

  const proposed = isAssistantAction(proposedAction)
    ? proposedAction
    : undefined;

  if (!proposed) return undefined;

  if (!hasService && proposed !== AssistantAction.ASK_SERVICE) {
    return AssistantAction.ASK_SERVICE;
  }

  // Nunca saltar a resumen/confirmación si aún no se capturó el barbero.
  // "sin preferencia" cuenta como staff válido (texto no vacío).
  const hasServiceDateTime = hasService && hasDate && hasTime;
  if (
    hasServiceDateTime &&
    !hasStaff &&
    proposed !== AssistantAction.ASK_STAFF &&
    proposed !== AssistantAction.ASK_SERVICE
  ) {
    return AssistantAction.ASK_STAFF;
  }

  if (proposed === AssistantAction.CONFIRM_BOOKING) {
    if (
      conversationState === 'CONFIRM_APPOINTMENT' &&
      hasService &&
      hasDate &&
      hasTime &&
      hasStaff
    ) {
      return AssistantAction.CONFIRM_BOOKING;
    }
    return AssistantAction.RESUMEN;
  }

  if (proposed === AssistantAction.RESUMEN) {
    if (hasService && hasDate && hasTime && hasStaff)
      return AssistantAction.RESUMEN;
    return AssistantAction.SHOW_HOURS;
  }

  if (proposed === AssistantAction.SHOW_HOURS) {
    // Para evitar sugerir horas que luego no apliquen al barbero elegido,
    // pedimos la preferencia de barbero antes de listar horarios.
    if (hasService && hasDate && !hasStaff) return AssistantAction.ASK_STAFF;
    if (hasService && hasDate) return AssistantAction.SHOW_HOURS;
    return AssistantAction.ASK_SERVICE;
  }

  return proposed;
};
