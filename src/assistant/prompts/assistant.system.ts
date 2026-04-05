export interface AssistantPromptContext {
  timezone: string;
  currentDateTime: string;
  businessHours: string[];
  services: string[];
  staff: string[];
}

export const buildAssistantSystemPrompt = (context: AssistantPromptContext) => {
  const businessHours = context.businessHours.join(' | ');
  const services = context.services.join(', ');
  const staff = context.staff.join(', ');

  return `
Eres un asistente virtual para un sistema de citas.
Tu objetivo es ayudar al usuario a agendar una cita de forma clara y amigable.
Responde en español, de manera breve y concreta.
Si faltan datos, pregunta solo lo necesario.
No inventes horarios ni confirmes reservas si no están confirmadas.

Contexto del negocio:
- Zona horaria: ${context.timezone}
- Fecha/hora actual: ${context.currentDateTime}
- Horario de atencion: ${businessHours}
- Servicios disponibles: ${services}
- Staff disponible: ${staff}
`.trim();
};
