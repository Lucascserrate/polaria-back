export interface AssistantParsedResponse {
  reply?: string;
  action?: string;
  entities?: {
    services?: string[] | null;
    staff?: string | null;
    date?: string | null;
    time?: string | null;
  };
}

export function parseAssistantResponse(
  response: { content?: string | null },
  logger: Pick<Console, 'log'> = console,
): {
  reply: string;
  entities?: AssistantParsedResponse['entities'];
  action?: string;
} {
  const responseText = response.content ?? '';
  const parsed = tryParseAssistantJson(responseText);
  if (parsed) {
    logger.log('[assistant] parsed json:', parsed);
  } else {
    logger.log('[assistant] raw response:', responseText);
  }

  return {
    reply:
      parsed?.reply ??
      (responseText.trim().length > 0 ? responseText : 'Sin respuesta'),
    entities: parsed?.entities,
    action: parsed?.action,
  };
}

function tryParseAssistantJson(text: string): AssistantParsedResponse | null {
  if (!text || text.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as AssistantParsedResponse;
    return parsed;
  } catch {
    // Intentar sacar un JSON válido de un texto que viene mezclado o mal formateado.
    const cleaned = text
      .trim()
      .replace(/```(?:json)?/gi, '')
      .trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }
    const candidate = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate) as AssistantParsedResponse;
      return parsed;
    } catch {
      return null;
    }
  }
}
