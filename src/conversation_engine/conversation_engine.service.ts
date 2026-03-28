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
          nowTime: this.conversationAvailabilityService.formatNowInZone(
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
    const serviceMatches =
      await this.conversationStateService.findServiceMatches(tenantId, message);
    const staffMatches = await this.conversationStateService.findStaffMatches(
      tenantId,
      message,
    );
    const existingServiceIds = readStringArray(context.serviceIds);
    const existingServiceNames = readStringArray(context.serviceNames);
    const existingStaffId = readString(context.staffId);
    const existingStaffName = readString(context.staffName);
    if (!existingServiceIds.length) {
      const fallbackId = readString(context.serviceId);
      if (fallbackId) {
        existingServiceIds.push(fallbackId);
      }
    }
    if (!existingServiceNames.length) {
      const fallbackName = readString(context.serviceName);
      if (fallbackName) {
        existingServiceNames.push(fallbackName);
      }
    }
    if (serviceMatches.length) {
      const mergedIds = new Set(existingServiceIds);
      const mergedNames = new Set(existingServiceNames);
      for (const match of serviceMatches) {
        mergedIds.add(match.id);
        mergedNames.add(match.name);
      }
      context.serviceIds = Array.from(mergedIds);
      context.serviceNames = Array.from(mergedNames);
      delete context.serviceId;
      delete context.serviceName;
    }
    if (staffMatches.length) {
      const staff = staffMatches[0];
      context.staffId = staff.id;
      context.staffName = staff.name;
    } else if (!existingStaffId && !existingStaffName) {
      delete context.staffId;
      delete context.staffName;
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

    const serviceIdsForDuration = readStringArray(context.serviceIds);
    if (!serviceIdsForDuration.length) {
      const fallbackId = readString(context.serviceId);
      if (fallbackId) {
        serviceIdsForDuration.push(fallbackId);
      }
    }
    const serviceDurationMinutes = serviceIdsForDuration.length
      ? await this.conversationStateService.getServicesDurationMinutes(
          tenantId,
          serviceIdsForDuration,
        )
      : null;
    const aiReply = await this.conversationAIFlowService.getReply({
      promptMessages,
      tenantId,
      timezone: timezoneSafe ?? undefined,
      durationMinutes: serviceDurationMinutes ?? undefined,
      stepMinutes: serviceDurationMinutes ?? 10,
      staffId: readString(context.staffId),
    });
    let finalReply = aiReply.reply;

    const aiServiceNames = readStringArray(aiReply.services);
    if (aiServiceNames.length) {
      const mergedIds = new Set(existingServiceIds);
      const mergedNames = new Set(existingServiceNames);
      for (const name of aiServiceNames) {
        const aiServiceMatch =
          await this.conversationStateService.findServiceMatch(tenantId, name);
        if (aiServiceMatch) {
          mergedIds.add(aiServiceMatch.id);
          mergedNames.add(aiServiceMatch.name);
        }
      }
      context.serviceIds = Array.from(mergedIds);
      context.serviceNames = Array.from(mergedNames);
      delete context.serviceId;
      delete context.serviceName;
    }
    if (aiReply.staff) {
      const aiStaffMatch = await this.conversationStateService.findStaffMatch(
        tenantId,
        aiReply.staff,
      );
      if (aiStaffMatch) {
        context.staffId = aiStaffMatch.id;
        context.staffName = aiStaffMatch.name;
      }
    }

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
    const hasService =
      readStringArray(context.serviceIds).length > 0 ||
      typeof context.serviceId === 'string';
    const normalizedDatetime = normalizeIsoDatetime(
      aiReply.datetime,
      timezoneSafe ?? undefined,
    );
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

    let confirmationStatus = aiReply.confirmationStatus;

    if (normalizedDatetime && (!hasName || !hasService)) {
      confirmationStatus = null;
      delete context.pendingDatetime;
      if (!hasName) {
        finalReply =
          'Necesito tu nombre para continuar con la reserva. ¿Cuál es?';
      } else if (!hasService) {
        finalReply = '¿Qué servicio deseas reservar?';
      }
    }

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
          timezone: timezoneSafe ?? undefined,
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

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function normalizeName(value: string | null | undefined) {
  if (!value || typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function normalizeIsoDatetime(
  value: string | null | undefined,
  timezone?: string,
) {
  if (!value || typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed.length) {
    return undefined;
  }
  const normalized = /([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed)
    ? trimmed
    : `${trimmed}${getTimeZoneOffset(timezone ?? 'UTC') ?? ''}`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
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

function isUserConfirmation(message: string) {
  const normalized = message
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return (
    normalized === 'si' ||
    normalized === 'sÃ­' ||
    normalized === 'ok' ||
    normalized === 'yes' ||
    normalized === 'de acuerdo' ||
    normalized.includes('confirmo') ||
    normalized.includes('confirmar')
  );
}
