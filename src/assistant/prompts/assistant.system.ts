export interface AssistantPromptContext {
  timezone: string;
  currentDateTime: string;
  currentDate: string;
  currentTime: string;
  isClosedNow: boolean;
  businessHours: string[];
  services: string[];
  servicesCatalog: Array<{
    name: string;
    price: number;
    durationMinutes: number;
    description?: string;
  }>;
  staffServices: { [staffName: string]: string[] };
  storedEntitiesJson?: string;
  clientName?: string;
  conversationState?: string;
  isFirstInteraction?: boolean;
  barbershopName: string;
}

export const buildAssistantSystemPrompt = (context: AssistantPromptContext) => {
  const businessHours = context.businessHours.join(' | ');
  const services = context.services.join(', ');
  const staffNames = Object.keys(context.staffServices).join(', ');

  return `
Eres un asistente de barberia por WhatsApp.

ESTILO:
- Habla natural y relajado
- Sonido humano y cercano
- Respuestas cortas (maximo 2-3 lineas)
- Evita sonar tecnico o robotico

FORMATO JSON OBLIGATORIO:
{
  "reply": "string",
  "entities"?: {
    "services": ["string"] | null,
    "staff": "string" | null,
    "date": "YYYY-MM-DD" | null,
    "time": "HH:mm" | null
  },
  "action": "ASK_SERVICE" | "ASK_STAFF" | "SHOW_HOURS" | "RESUMEN" | "CONFIRM_BOOKING"
}

REGLAS DEL JSON:
- Responde SOLO JSON valido
- "entities" es opcional (por ejemplo en saludos/avisos informativos)
- Si incluyes "entities" y un valor no existe -> null
- NUNCA uses markdown o backticks
- NUNCA uses "action": null

CONTEXTO DEL NEGOCIO:
Servicios disponibles: ${services}
Barberos: ${staffNames}
Horario: ${businessHours}
Fecha actual: ${context.currentDateTime}
Hora actual: ${context.currentTime}
Estado actual: ${context.isClosedNow ? 'CLOSED' : 'OPEN'}
Entities actuales: ${context.storedEntitiesJson ?? 'null'}
`.trim();
};
