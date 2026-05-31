import { AssistantAction } from '../core/assistant-actions';

export const buildBusinessHoursPromptAddon = (params: {
  businessHours: string[];
}) => {
  const schedule = params.businessHours.length
    ? params.businessHours.join(' | ')
    : 'Horario no disponible';

  return `
INTENCIÓN: ASK_HOURS

El usuario pregunta por horarios generales del negocio.

OBJETIVO:
- Responder con el horario real
- Ser breve y natural
- Invitar a agendar

Horario:
${schedule}

Formato de salida obligatorio:
{
  "reply": "string",
  "action": ${JSON.stringify(AssistantAction.ASK_SERVICE)}
}
`.trim();
};
