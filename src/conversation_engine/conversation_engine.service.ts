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
    const serviceNames = tenant ? await this.loadServiceNames(tenantId) : [];
    const tenantPrompt = tenant
      ? buildBookingPrompt({
          businessName: tenant.name,
          businessType: tenant.businessType as string,
          services: serviceNames,
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

    const aiReply = await this.conversationAIFlowService.getReply({
      promptMessages,
      tenantId,
      timezone: timezoneSafe ?? undefined,
    });
    let finalReply = aiReply.reply;

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

    const normalizedName = normalizeName(aiReply.name);
    if (normalizedName) {
      const identity: ConversationIdentityService =
        this.conversationIdentityService;
      await identity.updateClientName(client.id, normalizedName);
    }
    const hasName = Boolean(client.name || normalizedName);
    const hasService = typeof context.serviceId === 'string';
    const normalizedDatetime = normalizeIsoDatetime(aiReply.datetime);
    if (normalizedDatetime && aiReply.isAvailable && hasName && hasService) {
      context.pendingDatetime = normalizedDatetime;
    }
    if (aiReply.alternatives && aiReply.alternatives.length) {
      context.lastAlternatives = aiReply.alternatives;
      context.lastDate =
        typeof aiReply.requestedDate === 'string'
          ? aiReply.requestedDate
          : null;
    }

    let confirmationStatus =
      aiReply.confirmationStatus === 'pending' && isUserConfirmation(message)
        ? 'confirmed'
        : aiReply.confirmationStatus;

    if (
      (confirmationStatus === 'pending' ||
        confirmationStatus === 'confirmed') &&
      !hasName
    ) {
      confirmationStatus = null;
      finalReply =
        'Necesito tu nombre para continuar con la reserva. ¿Cuál es?';
    } else if (
      (confirmationStatus === 'pending' ||
        confirmationStatus === 'confirmed') &&
      !hasService
    ) {
      confirmationStatus = null;
      finalReply = '¿Qué servicio deseas reservar?';
    }

    if (confirmationStatus === 'rejected') {
      delete context.pendingDatetime;
    }

    if (confirmationStatus === 'confirmed' && hasName && hasService) {
      const bookingResult =
        await this.conversationBookingService.confirmPending({
          tenantId,
          clientId: client.id,
          conversationId: conversation.id,
          context,
        });
      if (bookingResult.handled) {
        return { message: bookingResult.reply };
      }
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

  private async loadServiceNames(tenantId: string): Promise<string[]> {
    try {
      const names =
        await this.conversationTenantService.findActiveServiceNames(tenantId);
      if (!Array.isArray(names)) {
        return [];
      }
      return names.filter((name): name is string => typeof name === 'string');
    } catch {
      return [];
    }
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

function normalizeName(value: string | null | undefined) {
  if (!value || typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function normalizeIsoDatetime(value: string | null | undefined) {
  if (!value || typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed.length) {
    return undefined;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : trimmed;
}

function isUserConfirmation(message: string) {
  const normalized = message
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return (
    normalized === 'si' ||
    normalized === 'sí' ||
    normalized === 'ok' ||
    normalized === 'de acuerdo' ||
    normalized.includes('confirmo') ||
    normalized.includes('confirmar')
  );
}
