import { Injectable } from '@nestjs/common';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { AIService } from '../../ai/ai.service';
import type { AssistantPromptContext } from '../prompts/assistant.system';
import { buildAssistantSystemPrompt } from '../prompts/assistant.system';
import { ServicesService } from '../../services/services.service';
import { SettingsService } from '../../settings/settings.service';

type EnrichmentNeeds = {
  prices?: boolean;
  services?: boolean;
  hours?: boolean;
  discounts?: boolean;
  location?: boolean;
};

@Injectable()
export class AssistantReplyEnricherService {
  constructor(
    private readonly aiService: AIService,
    private readonly servicesService: ServicesService,
    private readonly settingsService: SettingsService,
  ) {}

  private detectNeedsHeuristic(params: {
    historyMessages: ChatCompletionMessageParam[];
    baseReply: string;
  }): EnrichmentNeeds {
    const { historyMessages, baseReply } = params;

    const lastUserMessage = [...historyMessages]
      .reverse()
      .find((m) => m.role === 'user');
    const lastUserText =
      lastUserMessage && typeof lastUserMessage.content === 'string'
        ? lastUserMessage.content
        : '';

    const haystack = `${lastUserText}\n${baseReply}`.toLowerCase();
    const hasAny = (patterns: RegExp[]) =>
      patterns.some((p) => p.test(haystack));

    return {
      prices: hasAny([
        /\bprecio(s)?\b/i,
        /\bcuesta\b/i,
        /\bvalor\b/i,
        /\bcu[aá]nto\b/i,
      ]),
      hours: hasAny([
        /\bhorario(s)?\b/i,
        /\bhoras\b/i,
        /\babren\b/i,
        /\bcierran\b/i,
      ]),
      discounts: hasAny([
        /\bdescuento(s)?\b/i,
        /\bpromo(ciones)?\b/i,
        /\boferta(s)?\b/i,
      ]),
      location: hasAny([
        /\bubicaci[oó]n\b/i,
        /\bdirecci[oó]n\b/i,
        /\bd[oó]nde\b/i,
      ]),
    };
  }

  private async loadFacts(params: {
    tenantId: string;
    needs: EnrichmentNeeds;
  }): Promise<Record<string, unknown>> {
    const { tenantId, needs } = params;
    const facts: Record<string, unknown> = {};

    if (needs.prices) {
      const services = await this.servicesService.findActiveByTenant(tenantId);
      facts.services = services.map((s) => ({
        name: s.name,
        price: s.price,
        durationMinutes: s.durationMinutes,
      }));
    }

    if (needs.hours) {
      const settings = await this.settingsService.getSettings(tenantId);
      facts.openingHours = settings.openingHours;
      facts.workingDays = settings.workingDays;
      facts.polariaName = settings.polariaName;
    }

    if (needs.discounts) facts.discounts = null;
    if (needs.location) facts.location = null;

    return facts;
  }

  async enrich(params: {
    tenantId: string;
    promptContext: AssistantPromptContext;
    historyMessages: ChatCompletionMessageParam[];
    baseReply: string;
    action?: string;
  }): Promise<string> {
    const { tenantId, promptContext, historyMessages, baseReply, action } =
      params;

    if (action) return baseReply;

    const needs = this.detectNeedsHeuristic({ historyMessages, baseReply });

    const hasAnyNeed = Boolean(
      needs.prices ||
      needs.services ||
      needs.hours ||
      needs.discounts ||
      needs.location,
    );
    if (!hasAnyNeed) return baseReply;

    const facts = await this.loadFacts({ tenantId, needs });

    const rewritePrompt = `
      Reescribe el reply del asistente manteniendo el tono conversacional y el contexto.
      Usa SOLO estos datos reales si aplican. Si un dato no existe (null), dilo de forma honesta.
      No inventes precios, horarios, descuentos ni ubicación.

      Datos reales:
      ${JSON.stringify(facts)}

      Reply original:
      ${baseReply}

      Responde SOLO con texto plano.
      `.trim();

    const resp = await this.aiService.chat([
      { role: 'system', content: buildAssistantSystemPrompt(promptContext) },
      ...historyMessages,
      { role: 'system', content: rewritePrompt },
    ]);

    const text = (resp.content ?? '').trim();
    return text.length > 0 ? text : baseReply;
  }
}
