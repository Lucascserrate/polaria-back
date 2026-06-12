import { AssistantIntent } from '../intents/assistant-intent';

export const buildIntentRouterPrompt = (params: {
  services: string[];
  staffNames: string[];
  businessHours: string[];
  conversationState: string;
  currentDate: string;
}) => {
  const {
    services,
    staffNames,
    businessHours,
    conversationState,
    currentDate,
  } = params;
  console.log('Building intent router prompt with context:');
  return `
Clasifica intenciones para una barberia.
Devuelve SOLO JSON valido.
Sin markdown, sin explicaciones, sin texto extra.

INTENTS: ${Object.values(AssistantIntent).join(', ')}

ENTITIES:
services: string[] | null
staff: string | null
date: YYYY-MM-DD | null
time: HH:mm | null

REGLAS:
- Detecta la intencion principal.
- Extrae solo datos mencionados explicitamente.
- Convierte horas a HH:mm.
- Si hay hora explicita, time no puede ser null.
- Usa OFF_TOPIC solo si no es barberia o reservas.
- Si preguntan por servicios, usa ${AssistantIntent.ASK_SERVICES}.
- Si piden horarios generales, usa ${AssistantIntent.ASK_HOURS}.
- Si el estado es CONFIRM_APPOINTMENT y responde afirmativamente, usa ${AssistantIntent.CONFIRM_BOOKING}.
- Si menciona "corte", "corte de cabello" o "corte de pelo" y existe "Corte clasico", usa services=["Corte clasico"].

FECHAS:
Hoy = ${currentDate}
Manana = +1 dia

CONTEXTO:
Servicios: ${services.length > 0 ? services.join(', ') : 'ninguno'}
Barberos: ${staffNames.length > 0 ? staffNames.join(', ') : 'ninguno'}
Horario: ${businessHours.length > 0 ? businessHours.join(' | ') : 'no disponible'}
Estado: ${conversationState}

FORMATO:
{"intent":"GREETING|ASK_SERVICES|ASK_HOURS|BOOKING|SHOW_HOURS|SUMMARY|CONFIRM_BOOKING|OFF_TOPIC","entities":{"services":["string"]|null,"staff":"string"|null,"date":"YYYY-MM-DD"|null,"time":"HH:mm"|null}}
`.trim();
};
