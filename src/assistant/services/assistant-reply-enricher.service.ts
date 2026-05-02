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

  private async detectNeeds(params: {
    promptContext: AssistantPromptContext;
    historyMessages: ChatCompletionMessageParam[];
    baseReply: string;
  }): Promise<EnrichmentNeeds> {
    const { promptContext, historyMessages, baseReply } = params;
    const systemAddon = `
      Tarea: Decide si el reply del asistente necesita ser enriquecido con datos REALES del negocio (precios, servicios, horario, descuentos, ubicación).
        
      Reglas:
      - No cambies la intención del mensaje, solo detecta necesidades de datos.
      - Responde SOLO con JSON válido con este formato:
      {
        "prices": boolean,
        "services": boolean,
        "hours": boolean,
        "discounts": boolean,
        "location": boolean
      }
      `.trim();

    const resp = await this.aiService.chat([
      { role: 'system', content: buildAssistantSystemPrompt(promptContext) },
      ...historyMessages,
      { role: 'system', content: `Reply actual:\n${baseReply}` },
      { role: 'system', content: systemAddon },
    ]);

    try {
      const parsed = JSON.parse(resp.content ?? '{}') as EnrichmentNeeds;
      return parsed ?? {};
    } catch {
      return {};
    }
  }

  private async loadFacts(params: {
    tenantId: string;
    needs: EnrichmentNeeds;
  }): Promise<Record<string, unknown>> {
    const { tenantId, needs } = params;
    const facts: Record<string, unknown> = {};

    if (needs.services || needs.prices) {
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

    const needs = await this.detectNeeds({
      promptContext,
      historyMessages,
      baseReply,
    });

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
