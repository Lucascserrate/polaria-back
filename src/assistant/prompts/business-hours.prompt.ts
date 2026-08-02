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
- No inventes una hora concreta para reservar
- No digas "a las 16:00" o "a tal hora" si esa hora no fue enviada por el backend
- Si no hay horarios sugeridos, ofrece verificar disponibilidad o pide que elijan una hora aproximada

Horario:
${schedule}
Horario humano:
${humanSchedule}
Dias abiertos:
${daysOpen}

Formato de salida obligatorio:
{
  "reply": "string"
}
`.trim();
};
