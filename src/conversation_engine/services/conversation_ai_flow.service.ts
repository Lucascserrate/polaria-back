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
    durationMinutes?: number;
    stepMinutes?: number;
  }): Promise<{
    reply: string;
    name: string | null;
    services: string[] | null;
    datetime: string | null;
    confirmationStatus: 'confirmed' | 'pending' | 'rejected' | null;
    isAvailable: boolean | undefined;
    alternatives: string[];
    requestedDate: string | null;
  }> {
    const response = await this.aiService.chat(input.promptMessages, {
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'booking_reply',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: [
              'reply',
              'datetime',
              'name',
              'confirmation_status',
              'services',
            ],
            properties: {
              reply: { type: 'string' },
              datetime: { type: ['string', 'null'] },
              name: { type: ['string', 'null'] },
              confirmation_status: { type: ['string', 'null'] },
              services: {
                type: ['array', 'null'],
                items: { type: 'string' },
              },
            },
          },
          strict: true,
        },
      },
    });
    // dejo el log por si la IA no responde con el formato esperado, así se puede ajustar el prompt o revisar la respuesta.
    console.log('AI_RAW:', response?.content);

    const parsed = parseAiJson(response?.content ?? '');
    const normalizedDatetime = normalizeUtcDatetime(parsed.datetime);
    if (normalizedDatetime) {
      const requested = new Date(normalizedDatetime);
      if (!Number.isNaN(requested.getTime())) {
        const durationMinutes = input.durationMinutes ?? 30;
        const end = addMinutes(requested, durationMinutes);
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
              durationMinutes,
              limit: 3,
              stepMinutes: input.stepMinutes ?? durationMinutes,
              timezone: input.timezone,
            });

        const formattedAlternatives = alternatives.map((d) =>
          formatTime(d, input.timezone),
        );
        // console.log('AI_ALTERNATIVES:', formattedAlternatives);
        const finalReply = await this.buildAvailabilityReply({
          userMessage: findLastUserMessage(input.promptMessages),
          requestedDatetime: normalizedDatetime,
          isAvailable,
          alternatives: formattedAlternatives,
        });
        return {
          reply: finalReply,
          name: parsed.name,
          services: parsed.services,
          datetime: normalizedDatetime,
          confirmationStatus: normalizeConfirmation(parsed.confirmationStatus),
          isAvailable,
          alternatives: formattedAlternatives,
          requestedDate: normalizedDatetime.slice(0, 10),
        };
      }
    }

    return {
      reply: parsed.reply || response?.content || '',
      name: parsed.name,
      services: parsed.services,
      datetime: normalizedDatetime,
      confirmationStatus: normalizeConfirmation(parsed.confirmationStatus),
      isAvailable: undefined,
      alternatives: [],
      requestedDate: normalizedDatetime
        ? normalizedDatetime.slice(0, 10)
        : null,
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
  services: string[] | null;
  confirmationStatus: string | null;
} {
  try {
    const parsed = JSON.parse(raw) as {
      reply?: string;
      datetime?: string | null;
      name?: string | null;
      services?: string[] | null;
      confirmation_status?: string | null;
    };
    return {
      reply: typeof parsed.reply === 'string' ? parsed.reply : '',
      datetime: typeof parsed.datetime === 'string' ? parsed.datetime : null,
      name: typeof parsed.name === 'string' ? parsed.name : null,
      services: Array.isArray(parsed.services)
        ? parsed.services.filter((value) => typeof value === 'string')
        : null,
      confirmationStatus:
        typeof parsed.confirmation_status === 'string'
          ? parsed.confirmation_status
          : null,
    };
  } catch {
    const extracted = extractJson(raw);
    if (extracted) {
      try {
        const parsed = JSON.parse(extracted) as {
          reply?: string;
          datetime?: string | null;
          name?: string | null;
          services?: string[] | null;
          confirmation_status?: string | null;
        };
        return {
          reply: typeof parsed.reply === 'string' ? parsed.reply : raw,
          datetime:
            typeof parsed.datetime === 'string' ? parsed.datetime : null,
          name: typeof parsed.name === 'string' ? parsed.name : null,
          services: Array.isArray(parsed.services)
            ? parsed.services.filter((value) => typeof value === 'string')
            : null,
          confirmationStatus:
            typeof parsed.confirmation_status === 'string'
              ? parsed.confirmation_status
              : null,
        };
      } catch {
        return {
          reply: raw,
          datetime: null,
          name: null,
          services: null,
          confirmationStatus: null,
        };
      }
    }
    return {
      reply: raw,
      datetime: null,
      name: null,
      services: null,
      confirmationStatus: null,
    };
  }
}

function extractJson(raw: string) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return raw.slice(start, end + 1);
}

function normalizeConfirmation(value: string | null) {
  if (!value) return null;
  const normalized = value.toLowerCase().trim();
  if (normalized === 'confirmed') return 'confirmed';
  if (normalized === 'pending') return 'pending';
  if (normalized === 'rejected') return 'rejected';
  return null;
}

function addMinutes(date: Date, minutes: number) {
  const result = new Date(date);
  result.setMinutes(result.getMinutes() + minutes);
  return result;
}

function normalizeUtcDatetime(value: string | null) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed);
  return hasTimezone ? trimmed : `${trimmed}Z`;
}

function formatTime(date: Date, timezone?: string) {
  return date.toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
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
