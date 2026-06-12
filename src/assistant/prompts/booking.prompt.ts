import { AssistantAction } from '../core/assistant-actions';
import type { AssistantIntentEntities } from '../intents/assistant-intent';

export interface BookingPromptParams {
  action: AssistantAction;
  entities: AssistantIntentEntities;
  services: string[];
  businessHours: string[];
  businessHoursHuman?: string[];
  hasBusinessHours?: boolean;
  staffNames?: string[];
}

const formatVerticalList = (
  items: string[],
  params?: { max?: number; emptyLabel?: string },
) => {
  const max = params?.max ?? 6;
  const emptyLabel = params?.emptyLabel ?? 'disponibles';
  if (!items.length) return emptyLabel;
  return items
    .slice(0, max)
    .map((item) => `- ${item}`)
    .join('\n');
};

const jsonOrNull = (value: unknown) =>
  value === null || value === undefined ? 'null' : JSON.stringify(value);

const buildOutputFormat = (params: {
  services: unknown;
  staff: unknown;
  date: unknown;
  time: unknown;
  action: AssistantAction;
}) => `{
  "reply": "string",
  "entities": {
    "services": ${jsonOrNull(params.services)},
    "staff": ${jsonOrNull(params.staff)},
    "date": ${jsonOrNull(params.date)},
    "time": ${jsonOrNull(params.time)}
  },
  "action": ${JSON.stringify(params.action)}
}`;

/**
 * Estimacion rapida: 1 token ~ 4 chars (aprox). Util para presupuestos/costos,
 * pero NO es un conteo exacto.
 */
export const estimatePromptTokens = (text: string) =>
  Math.ceil(text.length / 4);

export const estimateBookingAddonTokens = (params: BookingPromptParams) =>
  estimatePromptTokens(buildBookingPromptAddon(params));

const buildAskServicePrompt = (params: {
  services: string[];
  entities: AssistantIntentEntities;
}) =>
  `
INTENCION: BOOKING
Falta: servicio.
Tarea: preguntar que servicio desea agendar.

IMPORTANTE:
- Si muestras servicios, usa lista vertical (WhatsApp-friendly).
- No uses comas para enumerar.
- NO afirmes "no hay disponibilidad" (ni para hoy/mañana) sin haber verificado con horarios reales.
- Si el usuario pide "para hoy" o pregunta "a qué hora puedo ir", responde pidiendo el servicio y la hora aproximada que prefiere.
- Evita inventar restricciones de días, promociones o reglas especiales a menos que el usuario o los datos reales las indiquen.

Servicios (max 6):
${formatVerticalList(params.services, {
  max: 6,
  emptyLabel: '- Nuestros servicios disponibles',
})}

Formato de salida obligatorio:
${buildOutputFormat({
  services: null,
  staff: params.entities.staff ?? null,
  date: params.entities.date ?? null,
  time: params.entities.time ?? null,
  action: AssistantAction.ASK_SERVICE,
})}
`.trim();

const buildAskDatePrompt = (params: { entities: AssistantIntentEntities }) =>
  `
INTENCION: BOOKING
Falta: fecha.
Tarea: preguntar que dia desea agendar de forma natural.

IMPORTANTE:
- No declares falta de disponibilidad sin verificacion.
- Si el usuario quiere "hoy" o "manana", pide confirmacion y normaliza la fecha internamente.
- Si necesitas mostrar ayuda de formato, hazlo breve y natural, sin sonar a formulario.

Formato de salida obligatorio:
${buildOutputFormat({
  services: params.entities.services ?? null,
  staff: params.entities.staff ?? null,
  date: null,
  time: params.entities.time ?? null,
  action: AssistantAction.ASK_DATE,
})}
`.trim();

const buildAskStaffPrompt = (params: {
  staffNames?: string[];
  entities: AssistantIntentEntities;
}) => {
  const staffPreview = params.staffNames?.length
    ? `\nAqui tienes algunos barberos disponibles (opcional, max 6):\n${formatVerticalList(
        params.staffNames,
        { max: 6, emptyLabel: '' },
      )}\n`
    : '';

  return `
INTENCION: BOOKING
Falta: barbero (preferencia).
Tarea: preguntar si tiene preferencia de barbero.

IMPORTANTE:
- Si mencionas barberos, SIEMPRE usa lista vertical.
- NUNCA pongas nombres separados por comas.
- El formato debe verse limpio para WhatsApp.
- Acepta respuestas como: "no", "sin preferencia", "cualquiera", "el que este disponible".
- Si el usuario dice "sin preferencia", guarda staff = null.
- NO digas "voy a revisar disponibilidad" ni muestres horarios todavia.
- NO inventes falta de disponibilidad (p.ej. "hoy no hay") solo por no tener un dato.

REGLA CLAVE:
- Si staffNames tiene datos, DEBES incluir 3-6 nombres como opciones en la MISMA respuesta (debajo de la pregunta).

Ejemplo esperado (formato):
Tienes alguna preferencia de barbero?
Aqui tienes algunos barberos disponibles:
- Luis
- Juan
- Carlos

${staffPreview}
Formato de salida obligatorio:
${buildOutputFormat({
  services: params.entities.services ?? null,
  staff: null,
  date: params.entities.date ?? null,
  time: params.entities.time ?? null,
  action: AssistantAction.ASK_STAFF,
})}
`.trim();
};

const buildShowHoursPrompt = (params: {
  businessHours: string[];
  businessHoursHuman?: string[];
  entities: AssistantIntentEntities;
}) =>
  `
INTENCION: BOOKING
Falta: hora.
Tarea: pedir/mostrar horarios reales (NO inventar).
Horario negocio: ${(params.businessHoursHuman ?? params.businessHours).join(' | ')}.
${params.businessHours.length === 0 ? 'No hay horarios cargados: indica que no hay atencion en este momento.' : ''}

Formato de salida obligatorio:
${buildOutputFormat({
  services: params.entities.services ?? null,
  staff: params.entities.staff ?? null,
  date: params.entities.date ?? null,
  time: null,
  action: AssistantAction.SHOW_HOURS,
})}
`.trim();

const buildConfirmBookingPrompt = (params: {
  entities: AssistantIntentEntities;
}) =>
  `
INTENCION: CONFIRM_BOOKING
Tarea: resumir la cita y pedir confirmacion final (si/no). No inventar datos.

Formato de salida obligatorio:
${buildOutputFormat({
  services: params.entities.services ?? null,
  staff: params.entities.staff ?? null,
  date: params.entities.date ?? null,
  time: params.entities.time ?? null,
  action: AssistantAction.CONFIRM_BOOKING,
})}
`.trim();

export const buildBookingPromptAddon = (params: BookingPromptParams) => {
  const {
    action,
    entities,
    services,
    businessHours,
    businessHoursHuman,
    staffNames,
  } = params;

  switch (action) {
    case AssistantAction.ASK_SERVICE:
      return buildAskServicePrompt({ services, entities });
    case AssistantAction.ASK_DATE:
      return buildAskDatePrompt({ entities });
    case AssistantAction.ASK_STAFF:
      return buildAskStaffPrompt({ staffNames, entities });
    case AssistantAction.SHOW_HOURS:
      return buildShowHoursPrompt({
        businessHours,
        businessHoursHuman,
        entities,
      });
    case AssistantAction.CONFIRM_BOOKING:
      return buildConfirmBookingPrompt({ entities });
    default:
      return `
INTENCION: BOOKING
Tarea: responder de forma breve y continuar el agendamiento.

Formato de salida obligatorio:
${buildOutputFormat({
  services: entities.services ?? null,
  staff: entities.staff ?? null,
  date: entities.date ?? null,
  time: entities.time ?? null,
  action: AssistantAction.ASK_SERVICE,
})}
`.trim();
  }
};
