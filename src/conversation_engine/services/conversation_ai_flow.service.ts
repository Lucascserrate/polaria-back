import { Injectable } from '@nestjs/common';
import { AIService } from '../../ai/ai.service';
import { ConversationAvailabilityService } from './conversation_availability.service';
import { formatTime } from '../utils/time_format';

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
    staffId?: string | null;
  }): Promise<{
    reply: string;
    name: string | null;
    services: string[] | null;
    staff: string | null;
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
              'staff',
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
              staff: { type: ['string', 'null'] },
            },
          },
          strict: true,
        },
      },
    });
    // dejo el log por si la IA no responde con el formato esperado, así se puede ajustar el prompt o revisar la respuesta.
    console.log('AI_RAW:', response?.content);

    const parsed = parseAiJson(response?.content ?? '');
    const normalizedDatetime = normalizeBackendDatetime(
      parsed.datetime,
      input.timezone,
    );
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
            input.staffId ?? undefined,
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
              staffId: input.staffId ?? undefined,
            });

        const formattedAlternatives = alternatives.map((d) =>
          formatTime(d, input.timezone),
        );
        // console.log('AI_ALTERNATIVES:', formattedAlternatives);
        return {
          reply: parsed.reply || response?.content || '',
          name: parsed.name,
          services: parsed.services,
          staff: parsed.staff,
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
      staff: parsed.staff,
      datetime: normalizedDatetime,
      confirmationStatus: normalizeConfirmation(parsed.confirmationStatus),
      isAvailable: undefined,
      alternatives: [],
      requestedDate: normalizedDatetime
        ? normalizedDatetime.slice(0, 10)
        : null,
    };
  }
}

function parseAiJson(raw: string): {
  reply: string;
  datetime: string | null;
  name: string | null;
  services: string[] | null;
  staff: string | null;
  confirmationStatus: string | null;
} {
  try {
    const parsed = JSON.parse(raw) as {
      reply?: string;
      datetime?: string | null;
      name?: string | null;
      services?: string[] | null;
      staff?: string | null;
      confirmation_status?: string | null;
    };
    return {
      reply: typeof parsed.reply === 'string' ? parsed.reply : '',
      datetime: typeof parsed.datetime === 'string' ? parsed.datetime : null,
      name: typeof parsed.name === 'string' ? parsed.name : null,
      services: Array.isArray(parsed.services)
        ? parsed.services.filter((value) => typeof value === 'string')
        : null,
      staff: typeof parsed.staff === 'string' ? parsed.staff : null,
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
          staff?: string | null;
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
          staff: typeof parsed.staff === 'string' ? parsed.staff : null,
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
          staff: null,
          confirmationStatus: null,
        };
      }
    }
    return {
      reply: raw,
      datetime: null,
      name: null,
      services: null,
      staff: null,
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

function normalizeBackendDatetime(value: string | null, timezone?: string) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed);
  const withTz = hasTimezone
    ? trimmed
    : `${trimmed}${getTimeZoneOffset(timezone ?? 'UTC') ?? ''}`;
  const parsed = new Date(withTz);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function getTimeZoneOffset(timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    const tz = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (!tz) {
      return null;
    }
    const match = tz.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
    if (!match) {
      return null;
    }
    const rawHours = Number(match[1]);
    if (Number.isNaN(rawHours)) {
      return null;
    }
    const sign = rawHours < 0 ? '-' : '+';
    const hours = Math.abs(rawHours).toString().padStart(2, '0');
    const minutes = (match[2] ?? '00').padStart(2, '0');
    return `${sign}${hours}:${minutes}`;
  } catch {
    return null;
  }
}
