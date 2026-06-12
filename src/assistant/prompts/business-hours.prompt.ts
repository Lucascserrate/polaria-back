import { AssistantAction } from '../core/assistant-actions';

export const buildBusinessHoursPromptAddon = (params: {
  businessHours: string[];
  businessHoursHuman?: string[];
  businessDaysOpen?: string[];
}) => {
  const schedule = params.businessHours.length
    ? params.businessHours.join(' | ')
    : 'Horario no disponible';
  const humanSchedule = params.businessHoursHuman?.length
    ? params.businessHoursHuman.join(' | ')
    : schedule;
  const daysOpen = params.businessDaysOpen?.length
    ? params.businessDaysOpen.join(', ')
    : 'no disponible';

  return `
INTENCION: ASK_HOURS

El usuario pregunta por horarios generales del negocio.

OBJETIVO:
- Responder con el horario real
- Ser breve y natural
- Invitar a agendar
- Si no hay horarios cargados, indica que no hay atencion en este momento
- Si hay dias abiertos, mencionalos de forma natural y completa
- No te quedes con un solo dia cuando existan varios

Horario:
${schedule}
Horario humano:
${humanSchedule}
Dias abiertos:
${daysOpen}

Formato de salida obligatorio:
{
  "reply": "string",
  "action": ${JSON.stringify(AssistantAction.ASK_SERVICE)}
}
`.trim();
};

export const buildAvailabilityReplyPrompt = (params: {
  mode: 'SHOW_HOURS' | 'ALTERNATIVES' | 'CLOSED_TODAY' | 'OUT_OF_HOURS';
  friendlySlots?: string[];
  businessHours?: string;
  dateHint?: string;
  staffHint?: string;
  startText?: string;
  endText?: string;
}) => {
  const slotsText = params.friendlySlots?.length
    ? params.friendlySlots.map((slot) => `- ${slot}`).join('\n')
    : 'Sin horarios disponibles';

  return `
INTENCION: RESPUESTA_DE_DISPONIBILIDAD

Tarea:
- Redactar una respuesta natural en español para WhatsApp.
- No inventar horarios ni cupos.
- Mantener un tono cercano, corto y humano.
- Si hay horarios sugeridos, mostrarlos en lista vertical.
- Si no hay horarios del negocio, responde que no hay atencion en este momento.
- No inventes dias como martes, sabados o promociones.

Modo: ${params.mode}
${params.dateHint ? `Contexto fecha: ${params.dateHint}` : ''}
${params.staffHint ? `Contexto barbero: ${params.staffHint}` : ''}
${params.startText ? `Abre a las: ${params.startText}` : ''}
${params.endText ? `Cierra a las: ${params.endText}` : ''}
${params.businessHours ? `Horario del negocio: ${params.businessHours}` : ''}

Horarios sugeridos:
${slotsText}

Responde SOLO con texto plano.
`.trim();
};
