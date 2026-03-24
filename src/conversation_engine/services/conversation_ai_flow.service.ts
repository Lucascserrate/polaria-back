import { Injectable } from '@nestjs/common';
import { AIService } from '../../ai/ai.service';
import { ConversationAvailabilityService } from './conversation_availability.service';

@Injectable()
export class ConversationAIFlowService {
  constructor(
    private readonly aiService: AIService,
    private readonly conversationAvailabilityService: ConversationAvailabilityService,
  ) {}

  // Envia a la IA y valida disponibilidad si viene datetime.
  async getReply(input: {
    promptMessages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
    }>;
    tenantId: string;
    timezone?: string;
  }) {
    const response = await this.aiService.chat(input.promptMessages, {
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'booking_reply',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['reply', 'datetime', 'name'],
            properties: {
              reply: { type: 'string' },
              datetime: { type: ['string', 'null'] },
              name: { type: ['string', 'null'] },
            },
          },
          strict: true,
        },
      },
    });
    // dejo el log por si la IA no responde con el formato esperado, así se puede ajustar el prompt o revisar la respuesta.
    console.log('AI_RAW:', response?.content);

    const parsed = parseAiJson(response?.content ?? '');
    if (parsed.datetime) {
      const requested = new Date(parsed.datetime);
      if (!Number.isNaN(requested.getTime())) {
        const end = addMinutes(requested, 30);
        const isAvailable =
          await this.conversationAvailabilityService.isSlotAvailable(
            input.tenantId,
            requested,
            end,
            input.timezone,
          );

        const alternatives = isAvailable
          ? []
          : await this.conversationAvailabilityService.getAlternativeTimes({
              tenantId: input.tenantId,
              start: requested,
              durationMinutes: 30,
              limit: 3,
              timezone: input.timezone,
            });

        const finalReply = await this.buildAvailabilityReply({
          userMessage: findLastUserMessage(input.promptMessages),
          requestedDatetime: parsed.datetime,
          isAvailable,
          alternatives: alternatives.map((d) => formatTime(d)),
        });
        return {
          reply: finalReply,
          name: parsed.name,
          datetime: parsed.datetime,
          isAvailable,
          alternatives: alternatives.map((d) => formatTime(d)),
          requestedDate: parsed.datetime.slice(0, 10),
        };
      }
    }

    return {
      reply: parsed.reply || response?.content || '',
      name: parsed.name,
      datetime: parsed.datetime,
      isAvailable: undefined,
      alternatives: [],
      requestedDate: parsed.datetime ? parsed.datetime.slice(0, 10) : null,
    };
  }

  private async buildAvailabilityReply(input: {
    userMessage: string;
    requestedDatetime: string;
    isAvailable: boolean;
    alternatives: string[];
  }) {
    const system = [
      'Responde como una persona real, natural y breve.',
      'Si is_available es true, confirma que ese horario esta disponible y pide confirmacion.',
      'Si is_available es false, ofrece las alternativas si existen.',
      'Si no hay alternativas, pide otra hora o dia.',
    ].join(' ');

    const payload = JSON.stringify(
      {
        user_message: input.userMessage,
        requested_datetime: input.requestedDatetime,
        is_available: input.isAvailable,
        alternatives: input.alternatives,
      },
      null,
      2,
    );

    const response = await this.aiService.chat([
      { role: 'system', content: system },
      { role: 'user', content: payload },
    ]);

    return response?.content ?? '';
  }
}

function parseAiJson(raw: string): {
  reply: string;
  datetime: string | null;
  name: string | null;
} {
  try {
    const parsed = JSON.parse(raw) as {
      reply?: string;
      datetime?: string | null;
      name?: string | null;
    };
    return {
      reply: typeof parsed.reply === 'string' ? parsed.reply : '',
      datetime: typeof parsed.datetime === 'string' ? parsed.datetime : null,
      name: typeof parsed.name === 'string' ? parsed.name : null,
    };
  } catch {
    return { reply: raw, datetime: null, name: null };
  }
}

function addMinutes(date: Date, minutes: number) {
  const result = new Date(date);
  result.setMinutes(result.getMinutes() + minutes);
  return result;
}

function formatTime(date: Date) {
  return date.toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function findLastUserMessage(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      return messages[i].content;
    }
  }
  return '';
}
