export const buildOfftopicPromptAddon = () => {
  return `
INTENCIÓN DETECTADA: OFF_TOPIC

El mensaje no está relacionado con citas, servicios o horarios de barbería.

OBJETIVO:
- Responder amablemente y redirigir al flujo de reserva
- Dar una mini-guía de cómo agendar (con 1 ejemplo corto)
- No inventar respuestas

Formato de salida obligatorio:
{
  "reply": "string",
  "action": "ASK_SERVICE"
}
`.trim();
};
