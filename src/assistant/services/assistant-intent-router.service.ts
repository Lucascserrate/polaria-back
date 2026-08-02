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

/**
 * Router de intención.
 *
 * Con el flujo guiado de reservas, este servicio pasó a ser el límite del poder
 * de la IA sobre una reserva: puede decir *que* el usuario quiere reservar, y
 * nada más. Las entidades que devuelve (`services`, `staff`, `date`, `time`) se
 * conservan en el tipo por compatibilidad, pero el flujo de reserva las ignora
 * por completo.
 *
 * Ya no existen atajos basados en el estado de la conversación. Servían para
 * continuar una reserva conversacional —"responde con un nombre de barbero
 * mientras el estado es ASK_STAFF"— y esos estados desaparecieron junto con esa
 * forma de reservar.
 */
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
    businessDaysOpen: string[];
    currentDate: string;
  }): Promise<AssistantIntentRouterResult> {
    const systemPrompt = buildIntentRouterPrompt({
      services: params.services,
      staffNames: params.staffNames,
      businessHours: params.businessHours,
      businessDaysOpen: params.businessDaysOpen,
      conversationState: 'IDLE',
      currentDate: params.currentDate,
      tomorrowDate:
        addDaysToYYYYMMDD(params.currentDate, 1) ?? params.currentDate,
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
      params.currentDate,
    );
  }

  private parseRouterResponse(
    rawText: string,
    messageText: string,
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
      return this.fallback(messageText);
    }

    const candidate = cleaned.slice(firstBrace, lastBrace + 1);

    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!this.isRouterResponse(parsed)) {
        return this.fallback(messageText);
      }

      const intent = this.isAssistantIntent(parsed.intent)
        ? parsed.intent
        : undefined;

      const entities = this.normalizeEntities(parsed.entities, currentDate);

      if (!intent) {
        return this.fallback(messageText, entities);
      }

      return { intent, entities };
    } catch (error) {
      this.logger.warn('Router JSON parse failed', error as Error);
      return this.fallback(messageText);
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
      return { services: null, staff: null, date: null, time: null };
    }

    const raw = value as Record<string, unknown>;

    const normalizeDate = (date: unknown, baseDate: string): string | null => {
      if (typeof date !== 'string') return null;
      const trimmed = date.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

      const token = trimmed.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (token === 'hoy') return baseDate;
      if (token === 'manana') return addDaysToYYYYMMDD(baseDate, 1);
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

  /**
   * Cuando el modelo no devuelve JSON usable, se cae a la detección por palabras
   * clave. Prefiere `OFF_TOPIC`, que solo produce una respuesta conversacional.
   */
  private fallback(
    messageText: string,
    entities: AssistantIntentEntities = {
      services: null,
      staff: null,
      date: null,
      time: null,
    },
  ): AssistantIntentRouterResult {
    const fallbackIntent = detectIntent({ messageText });
    if (fallbackIntent === UserIntent.GREETING) {
      return { intent: AssistantIntent.GREETING, entities };
    }
    if (fallbackIntent === UserIntent.BOOKING_INTENT) {
      return { intent: AssistantIntent.BOOKING, entities };
    }
    return { intent: AssistantIntent.OFF_TOPIC, entities };
  }

  private isAssistantIntent(value: unknown): value is AssistantIntent {
    return (
      typeof value === 'string' &&
      Object.values(AssistantIntent).includes(value as AssistantIntent)
    );
  }
}

function addDaysToYYYYMMDD(date: string, days: number): string | null {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
