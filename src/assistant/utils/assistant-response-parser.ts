export interface AssistantParsedResponse {
  reply?: string;
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
): { reply: string } {
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
    return null;
  }
}
