import { Injectable, Logger } from '@nestjs/common';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { AIService } from '../../ai/ai.service';
import { buildIntentRouterPrompt } from '../prompts/intent-router.prompt';
import {
  AssistantIntent,
  AssistantIntentEntities,
  AssistantIntentRouterResult,
} from '../intents/assistant-intent';
import { detectIntent } from '../intents/detect-intent';
import { UserIntent } from '../intents/user-intent';

@Injectable()
export class AssistantIntentRouterService {
  private readonly logger = new Logger(AssistantIntentRouterService.name);
  private readonly jsonOnlyReminder =
    'Responde SOLO con JSON válido. No agregues texto o explicaciones fuera del JSON.';

  constructor(private readonly aiService: AIService) {}

  async routeIntent(params: {
    messageText: string;
    services: string[];
    staffNames: string[];
    businessHours: string[];
    conversationState: string;
    currentDate: string;
  }): Promise<AssistantIntentRouterResult> {
    const normalizeComparable = (text: string) => {
      const withoutParens = text.replace(/\([^)]*\)/g, ' ');
      return withoutParens
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const normalizedMessage = normalizeComparable(params.messageText);

    if (
      params.conversationState === 'CONFIRM_APPOINTMENT' &&
      /(^|\s)(quien|qu[eé]n|que barbero|qu[eé]\s+barbero|barbero)\b/.test(
        normalizedMessage,
      ) &&
      /atender|atiende|atendera|va a atender|me atiende/.test(normalizedMessage)
    ) {
      return {
        intent: AssistantIntent.SUMMARY,
        entities: {
          services: null,
          staff: null,
          date: null,
          time: null,
        },
      };
    }

    // Shortcut: si estamos preguntando por servicio y el usuario responde con un servicio real,
    // tratamos esto como continuación de BOOKING (evita repetir el catálogo).
    if (params.conversationState === 'ASK_SERVICE' && params.services.length) {
      const normalizedUser = normalizedMessage;
      const matchedService = params.services.find((serviceName) => {
        const normalizedService = normalizeComparable(serviceName);
        if (!normalizedService) return false;
        return (
          normalizedUser === normalizedService ||
          normalizedUser.includes(normalizedService) ||
          normalizedService.includes(normalizedUser)
        );
      });

      if (matchedService) {
        return {
          intent: AssistantIntent.BOOKING,
          entities: {
            services: [matchedService],
            staff: null,
            date: null,
            time: null,
          },
        };
      }
    }

    // Shortcut: si estamos sugiriendo horarios y el usuario responde con una hora,
    // tratamos esto como continuación de BOOKING.
    if (
      (params.conversationState === 'SUGGEST_SLOTS' ||
        params.conversationState === 'ASK_SLOT') &&
      typeof params.messageText === 'string'
    ) {
      const normalizedUser = normalizedMessage;

      const parseTime = (text: string): string | null => {
        // HH:mm (9:30, 09:30)
        const m1 = text.match(/\b(\d{1,2})\s*:\s*(\d{2})\b/);
        if (m1) {
          const h = Number(m1[1]);
          const min = Number(m1[2]);
          if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
            return `${String(h).padStart(2, '0')}:${String(min).padStart(
              2,
              '0',
            )}`;
          }
        }

        // HHmm (930, 0930, 1230)
        const m2 = text.match(/\b(\d{3,4})\b/);
        if (m2) {
          const raw = m2[1];
          const padded = raw.length === 3 ? `0${raw}` : raw;
          const h = Number(padded.slice(0, 2));
          const min = Number(padded.slice(2, 4));
          if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
            return `${String(h).padStart(2, '0')}:${String(min).padStart(
              2,
              '0',
            )}`;
          }
        }

        // Solo hora (9, 16) -> asumimos :00
        const m3 = text.match(/\b(\d{1,2})\b/);
        if (m3) {
          const h = Number(m3[1]);
          if (h >= 0 && h <= 23) {
            return `${String(h).padStart(2, '0')}:00`;
          }
        }

        return null;
      };

      const time = parseTime(normalizedUser);
      if (time) {
        return {
          intent: AssistantIntent.BOOKING,
          entities: {
            services: null,
            staff: null,
            date: null,
            time,
          },
        };
      }
    }

    // Shortcut: si estamos preguntando por barbero y el usuario responde con un nombre
    // que coincide con staffNames, tratamos esto como continuación de BOOKING.
    // Evita que el router confunda el nombre con ASK_SERVICES / OFF_TOPIC y ahorra tokens.
    if (params.conversationState === 'ASK_STAFF' && params.staffNames.length) {
      const normalizedUser = normalizedMessage;
      const noPreferencePatterns = [
        'no',
        'sin preferencia',
        'no tengo preferencia',
        'no tengo preferencias',
        'no hay preferencia',
        'cualquiera',
        'me da igual',
        'indiferente',
        'no importa',
      ];
      const hasNoPreference = noPreferencePatterns.some((p) =>
        p === 'no'
          ? normalizedUser === 'no' ||
            normalizedUser.startsWith('no ') ||
            normalizedUser.endsWith(' no') ||
            /\bno\b/.test(normalizedUser)
          : normalizedUser.includes(p),
      );
      if (hasNoPreference) {
        return {
          intent: AssistantIntent.BOOKING,
          entities: {
            services: null,
            staff: 'sin preferencia',
            date: null,
            time: null,
          },
        };
      }

      const levenshtein = (a: string, b: string) => {
        if (a === b) return 0;
        if (!a.length) return b.length;
        if (!b.length) return a.length;

        const prev: number[] = Array.from(
          { length: b.length + 1 },
          (_, j) => j,
        );
        const curr: number[] = new Array<number>(b.length + 1).fill(0);

        for (let i = 1; i <= a.length; i++) {
          curr[0] = i;
          const ai = a.charCodeAt(i - 1);
          for (let j = 1; j <= b.length; j++) {
            const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
            curr[j] = Math.min(
              prev[j] + 1,
              curr[j - 1] + 1,
              prev[j - 1] + cost,
            );
          }
          for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
        }
        return prev[b.length];
      };

      const normalizedUserTokens = normalizedUser.split(' ').filter(Boolean);
      const normalizedUserShort =
        normalizedUserTokens.length > 0 ? normalizedUserTokens[0] : '';

      const normalizedStaff = params.staffNames.map((original) => {
        const normalized = normalizeComparable(original);
        const tokens = normalized.split(' ').filter(Boolean);
        const short = tokens.length > 0 ? tokens[0] : normalized;
        return { original, normalized, short };
      });

      const exact =
        normalizedStaff.find((s) => s.normalized === normalizedUser) ??
        (normalizedUserShort
          ? normalizedStaff.find((s) => s.short === normalizedUserShort)
          : undefined);

      const matched = exact?.original ?? null;

      const fuzzy = matched
        ? null
        : normalizedUserShort.length >= 3
          ? normalizedStaff
              .map((s) => ({
                original: s.original,
                distance: levenshtein(s.short, normalizedUserShort),
              }))
              .sort((a, b) => a.distance - b.distance)[0]
          : null;

      const fuzzyMatch =
        fuzzy && Number.isFinite(fuzzy.distance) && fuzzy.distance <= 2
          ? fuzzy.original
          : null;

      const resolved = matched ?? fuzzyMatch;
      if (resolved) {
        return {
          intent: AssistantIntent.BOOKING,
          entities: {
            services: null,
            staff: resolved,
            date: null,
            time: null,
          },
        };
      }
    }

    const systemPrompt = buildIntentRouterPrompt({
      services: params.services,
      staffNames: params.staffNames,
      businessHours: params.businessHours,
      conversationState: params.conversationState,
      currentDate: params.currentDate,
    });

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: params.messageText },
      { role: 'system', content: this.jsonOnlyReminder },
    ];

    const response = await this.aiService.chatRaw(messages);
    const rawContent = response.choices[0]?.message?.content ?? '';

    return this.parseRouterResponse(
      rawContent,
      params.messageText,
      params.conversationState,
      params.currentDate,
    );
  }

  private parseRouterResponse(
    rawText: string,
    messageText: string,
    conversationState: string,
    currentDate: string,
  ): AssistantIntentRouterResult {
    const cleaned = rawText
      .trim()
      .replace(/```(?:json)?/gi, '')
      .trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      this.logger.warn('Router response could not be parsed as JSON');
      return this.fallback(messageText, conversationState);
    }

    const candidate = cleaned.slice(firstBrace, lastBrace + 1);

    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!this.isRouterResponse(parsed)) {
        return this.fallback(messageText, conversationState);
      }

      const intent = this.isAssistantIntent(parsed.intent)
        ? parsed.intent
        : undefined;

      const entities = this.normalizeEntities(parsed.entities, currentDate);

      if (!intent) {
        return this.fallback(messageText, conversationState, entities);
      }

      return { intent, entities };
    } catch (error) {
      this.logger.warn('Router JSON parse failed', error as Error);
      return this.fallback(messageText, conversationState);
    }
  }

  private isRouterResponse(value: unknown): value is {
    intent?: unknown;
    entities?: unknown;
  } {
    return typeof value === 'object' && value !== null;
  }

  private normalizeEntities(
    value: unknown,
    currentDate: string,
  ): AssistantIntentEntities {
    if (!value || typeof value !== 'object') {
      return {
        services: null,
        staff: null,
        date: null,
        time: null,
      };
    }

    const raw = value as Record<string, unknown>;

    const normalizeText = (text: string) =>
      text
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const addDaysToYYYYMMDD = (date: string, days: number) => {
      const parsed = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime())) return null;
      parsed.setUTCDate(parsed.getUTCDate() + days);
      return parsed.toISOString().slice(0, 10);
    };

    const normalizeDate = (date: unknown, baseDate: string): string | null => {
      if (typeof date !== 'string') return null;
      const trimmed = date.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

      const token = normalizeText(trimmed);
      if (token === 'hoy') return baseDate;
      if (token === 'manana' || token === 'mañana') {
        return addDaysToYYYYMMDD(baseDate, 1);
      }
      return null;
    };

    return {
      services: Array.isArray(raw.services)
        ? raw.services.filter((item) => typeof item === 'string')
        : null,
      staff: typeof raw.staff === 'string' ? raw.staff : null,
      date: normalizeDate(raw.date, currentDate),
      time: typeof raw.time === 'string' ? raw.time : null,
    };
  }

  private fallback(
    messageText: string,
    conversationState: string,
    entities: AssistantIntentEntities = {
      services: null,
      staff: null,
      date: null,
      time: null,
    },
  ): AssistantIntentRouterResult {
    if (
      conversationState === 'CONFIRM_APPOINTMENT' &&
      this.isAffirmativeReply(messageText)
    ) {
      return { intent: AssistantIntent.CONFIRM_BOOKING, entities };
    }

    const fallbackIntent = detectIntent({ messageText });
    if (fallbackIntent === UserIntent.GREETING) {
      return { intent: AssistantIntent.GREETING, entities };
    }
    if (fallbackIntent === UserIntent.BOOKING_INTENT) {
      return { intent: AssistantIntent.BOOKING, entities };
    }
    return { intent: AssistantIntent.OFF_TOPIC, entities };
  }

  private isAffirmativeReply(messageText: string): boolean {
    const normalized = messageText
      .toLowerCase()
      .normalize('NFD')
      .replace(/[^a-z0-9\sáéíóúüñ]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const affirmatives = new Set([
      'si',
      'sí',
      'claro',
      'por favor',
      'dale',
      'ok',
      'vale',
      'perfecto',
      'confirmar',
    ]);
    return (
      affirmatives.has(normalized) ||
      normalized.split(' ').some((word) => affirmatives.has(word))
    );
  }

  private isAssistantIntent(value: unknown): value is AssistantIntent {
    return (
      typeof value === 'string' &&
      Object.values(AssistantIntent).includes(value as AssistantIntent)
    );
  }
}
