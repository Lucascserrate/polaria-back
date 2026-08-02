/**
 * Lectura de la respuesta del modelo.
 *
 * El asistente solo produce texto. Antes esta función también extraía
 * `entities` y `action` —servicio, barbero, fecha y hora inferidos del
 * mensaje—, que era el mecanismo con el que la IA armaba una reserva. Esos
 * campos se eliminaron del prompt y de acá: si el modelo los devolviera igual,
 * se ignoran.
 */
export interface AssistantParsedResponse {
  reply?: string;
}

export function parseAssistantResponse(response: { content?: string | null }): {
  reply: string;
} {
  const responseText = response.content ?? '';
  const parsed = tryParseAssistantJson(responseText);

  if (parsed?.reply) {
    return { reply: parsed.reply };
  }

  // El modelo puede responder en texto plano pese al formato pedido; se aprovecha
  // igual en lugar de descartar una respuesta válida.
  const trimmed = responseText.trim();
  return { reply: trimmed.length > 0 ? trimmed : 'Sin respuesta' };
}

function tryParseAssistantJson(text: string): AssistantParsedResponse | null {
  if (!text || text.trim().length === 0) return null;

  try {
    return JSON.parse(text) as AssistantParsedResponse;
  } catch {
    // El modelo a veces envuelve el JSON en backticks o lo mezcla con texto.
    const cleaned = text
      .trim()
      .replace(/```(?:json)?/gi, '')
      .trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }

    try {
      return JSON.parse(
        cleaned.slice(firstBrace, lastBrace + 1),
      ) as AssistantParsedResponse;
    } catch {
      return null;
    }
  }
}
