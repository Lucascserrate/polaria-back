import { Injectable } from '@nestjs/common';
import { ChatMessageDto } from './dto/chat-message.dto';
import { MessageRole } from '../messages/entities/message.entity';
import { ConversationIdentityService } from './services/conversation_identity.service';
import { ConversationMessagesService } from './services/conversation_messages.service';
import { ConversationTenantService } from './services/conversation_tenant.service';
import { buildBookingPrompt } from './prompts/booking_prompt';
import { ConversationStateService } from './services/conversation_state.service';
import { ConversationAIFlowService } from './services/conversation_ai_flow.service';
import { ConversationBookingService } from './services/conversation_booking.service';
import { ConversationAvailabilityService } from './services/conversation_availability.service';

@Injectable()
export class ConversationEngineService {
  constructor(
    private readonly conversationIdentityService: ConversationIdentityService,
    private readonly conversationMessagesService: ConversationMessagesService,
    private readonly conversationTenantService: ConversationTenantService,
    private readonly conversationStateService: ConversationStateService,
    private readonly conversationAIFlowService: ConversationAIFlowService,
    private readonly conversationBookingService: ConversationBookingService,
    private readonly conversationAvailabilityService: ConversationAvailabilityService,
  ) {}

  // Orquesta el flujo: arma prompt, agrega historial y guarda mensajes.
  async handleMessage(body: ChatMessageDto) {
    const input = body as {
      message?: unknown;
      systemPrompt?: unknown;
      tenantId?: unknown;
      phone?: unknown;
    };
    const tenantId = readString(input.tenantId) ?? '';
    const phone = readString(input.phone) ?? '';
    const systemPromptOverride = normalizePrompt(
      readString(input.systemPrompt),
    );
    const tenant = await this.conversationTenantService.findTenant(tenantId);
    if (!tenant || !tenant.name || !tenant.businessType) {
      if (!systemPromptOverride) {
        return { message: 'Tenant invalido o sin configuracion.' };
      }
    }

    const timezoneSafe = 'America/La_Paz';
    const tenantPrompt = tenant
      ? buildBookingPrompt({
          businessName: tenant.name,
          businessType: tenant.businessType as string,
          services: [],
          timezone: timezoneSafe ?? undefined,
          today: this.conversationAvailabilityService.formatTodayInZone(
            timezoneSafe ?? undefined,
          ),
        })
      : null;
    if (!systemPromptOverride && !tenantPrompt) {
      return { message: 'Tenant invalido o sin configuracion.' };
    }
    const systemPrompt = systemPromptOverride ?? tenantPrompt ?? '';

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt,
      });
    }
    const message = readString(input.message) ?? '';
    messages.push({
      role: 'user',
      content: message,
    });

    const { client, conversation } =
      await this.conversationIdentityService.resolveClientAndConversation(
        tenantId,
        phone,
      );
    const context =
      (conversation.contextJson as Record<string, unknown> | null) || {};
    const serviceMatch = await this.conversationStateService.findServiceMatch(
      tenantId,
      message,
    );
    if (serviceMatch && !context.serviceId) {
      context.serviceId = serviceMatch.id;
      context.serviceName = serviceMatch.name;
    }

    const selection = resolveAlternativeSelection(
      message,
      context.lastAlternatives as string[] | undefined,
    );
    const lastDate =
      typeof context.lastDate === 'string' ? context.lastDate : null;
    if (selection && lastDate) {
      const pending = buildPendingDatetime(lastDate, selection);
      if (pending) {
        context.pendingDatetime = pending;
        delete context.lastAlternatives;
        delete context.lastDate;

        const reply = `Perfecto. ¿Confirmas la cita para el ${lastDate} a las ${selection}?`;
        await this.conversationMessagesService.saveMessage({
          tenantId: conversation.tenantId,
          conversationId: conversation.id,
          clientId: client.id,
          role: MessageRole.USER,
          content: message,
        });
        await this.conversationMessagesService.saveMessage({
          tenantId: conversation.tenantId,
          conversationId: conversation.id,
          clientId: client.id,
          role: MessageRole.ASSISTANT,
          content: reply,
        });
        await this.conversationIdentityService.updateConversationContext(
          conversation.id,
          context,
        );
        return { message: reply };
      }
    }
    const contextNote = buildContextNote({
      clientName: client.name ?? null,
      serviceName:
        typeof context.serviceName === 'string' ? context.serviceName : null,
      pendingDatetime:
        typeof context.pendingDatetime === 'string'
          ? context.pendingDatetime
          : null,
      mentionedDateTime: hasDateOrTimeMention(message),
    });
    if (contextNote) {
      messages.push({
        role: 'system',
        content: contextNote,
      });
    }
    const history = await this.conversationMessagesService.getRecentMessages(
      conversation.id,
      12,
    );
    const promptMessages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
    }> = [];
    if (messages[0]?.role === 'system') {
      promptMessages.push(messages[0]);
    }
    promptMessages.push(...history);
    promptMessages.push(messages[messages.length - 1]);

    const bookingResult =
      await this.conversationBookingService.tryConfirmAndCreate({
        tenantId,
        message,
        clientId: client.id,
        conversationId: conversation.id,
        context,
      });
    if (bookingResult.handled) {
      return { message: bookingResult.reply };
    }

    const aiReply = await this.conversationAIFlowService.getReply({
      promptMessages,
      tenantId,
      timezone: timezoneSafe ?? undefined,
    });
    const finalReply = aiReply.reply;

    await this.conversationMessagesService.saveMessage({
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
      clientId: client.id,
      role: MessageRole.USER,
      content: message,
    });
    await this.conversationMessagesService.saveMessage({
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
      clientId: client.id,
      role: MessageRole.ASSISTANT,
      content: finalReply,
    });

    if (aiReply.name) {
      const identity: ConversationIdentityService =
        this.conversationIdentityService;
      await identity.updateClientName(client.id, aiReply.name);
    }
    if (aiReply.datetime && aiReply.isAvailable) {
      context.pendingDatetime = aiReply.datetime;
    }
    if (aiReply.alternatives && aiReply.alternatives.length) {
      context.lastAlternatives = aiReply.alternatives;
      context.lastDate =
        typeof aiReply.requestedDate === 'string'
          ? aiReply.requestedDate
          : null;
    }

    const nextState = await this.conversationStateService.resolveState({
      tenantId,
      message,
    });
    await this.conversationIdentityService.touchConversation(
      conversation.id,
      nextState,
    );

    await this.conversationIdentityService.updateConversationContext(
      conversation.id,
      context,
    );

    return { message: finalReply };
  }
}

function normalizePrompt(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

// Normaliza entrada desconocida a string segura.
function readString(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }
  return value;
}

function resolveAlternativeSelection(message: string, alternatives?: string[]) {
  if (!alternatives || alternatives.length === 0) {
    return null;
  }
  const normalized = message
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const direct = alternatives.find((time) =>
    normalized.includes(time.replace(/\s+/g, '').toLowerCase()),
  );
  if (direct) {
    return direct;
  }

  const match = normalized.match(/(\d{1,2})(?::(\d{2}))?/);
  if (!match) {
    return null;
  }
  const hour = match[1].padStart(2, '0');
  const minute = match[2] || (normalized.includes('media') ? '30' : '00');
  const candidate = `${hour}:${minute}`;
  return alternatives.find((time) => time.startsWith(candidate)) || null;
}

function buildPendingDatetime(date: string, time: string) {
  const timeMatch = time.match(/(\d{1,2}):(\d{2})/);
  if (!timeMatch) {
    return null;
  }
  const hour = timeMatch[1].padStart(2, '0');
  const minute = timeMatch[2].padStart(2, '0');
  return `${date}T${hour}:${minute}:00-04:00`;
}

function hasDateOrTimeMention(message: string) {
  const normalized = message
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const hasDate =
    normalized.includes('hoy') ||
    normalized.includes('manana') ||
    normalized.includes('pasado manana') ||
    [
      'lunes',
      'martes',
      'miercoles',
      'jueves',
      'viernes',
      'sabado',
      'domingo',
    ].some((day) => normalized.includes(day));
  const hasTime = /(?:a las\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.test(
    normalized,
  );
  return hasDate || hasTime;
}

function buildContextNote(input: {
  clientName: string | null;
  serviceName: string | null;
  pendingDatetime: string | null;
  mentionedDateTime: boolean;
}) {
  const missing: string[] = [];
  if (!input.clientName) {
    missing.push('nombre');
  }
  if (!input.serviceName) {
    missing.push('servicio');
  }
  if (!input.pendingDatetime && !input.mentionedDateTime) {
    missing.push('fecha/hora');
  }

  const parts: string[] = [];
  parts.push('Contexto actual del cliente:');
  parts.push(`- Nombre: ${input.clientName ?? 'no registrado'}.`);
  parts.push(`- Servicio: ${input.serviceName ?? 'no definido'}.`);
  parts.push(
    `- Fecha/hora solicitada: ${input.pendingDatetime ?? 'no definida'}.`,
  );
  if (missing.length) {
    parts.push(
      `Falta obtener: ${missing.join(', ')}. Pregunta solo por lo faltante.`,
    );
  }
  return parts.join(' ');
}
