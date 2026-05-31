import { Injectable } from '@nestjs/common';
import { AvailabilityService } from '../../availability/availability.service';
import { ServicesService } from '../../services/services.service';
import { StaffService } from '../../staff/staff.service';
import type { AssistantParsedResponse } from '../utils/assistant-response-parser';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { ConversationsService } from '../../conversations/conversations.service';
import { ConversationState } from '../../conversations/entities/conversation.entity';
import type { AssistantPromptContext } from '../prompts/assistant.system';
import type { Conversation } from '../../conversations/entities/conversation.entity';
import type { AssistantChatDto } from '../dto/assistant-chat.dto';
import {
  buildAvailabilityKey,
  hasAvailabilityEntities,
  mapServices,
  mapStaff,
} from './availability/availability-helpers';

const parseTimeToMinutes = (raw: string): number | null => {
  const text = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\./g, '')
    .trim();

  // 24h: 18:30 / 18
  let match = text.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (match) {
    const hours = Number(match[1]);
    const minutes = match[2] ? Number(match[2]) : 0;
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return hours * 60 + minutes;
    }
    return null;
  }

  // 12h: 6 pm / 6:30 p m / 6:30pm
  match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\s*m|p\s*m)$/);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const suffix = match[3].replace(/\s+/g, '');
  if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;
  if (suffix === 'pm' && hours !== 12) hours += 12;
  if (suffix === 'am' && hours === 12) hours = 0;
  return hours * 60 + minutes;
};

const parseBusinessHoursForDay = (
  businessHours: string[],
  dayOfWeek: number,
): { startMinutes: number; endMinutes: number } | null => {
  // Expected format: "Dia X: HH:MM-HH:MM"
  const targetPrefix = `dia ${dayOfWeek}:`;
  const line = businessHours.find((h) =>
    h.toLowerCase().trim().startsWith(targetPrefix),
  );
  if (!line) return null;

  const match = line.match(/:\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
  if (!match) return null;

  const start = parseTimeToMinutes(match[1]);
  const end = parseTimeToMinutes(match[2]);
  if (start === null || end === null) return null;
  return { startMinutes: start, endMinutes: end };
};

const getIsoDayOfWeek = (isoDate: string): number | null => {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (Number.isNaN(date.getTime())) return null;
  // 0=Sunday..6=Saturday; assume backend uses same convention for dayOfWeek
  return date.getUTCDay();
};

const formatMinutesToTime = (minutes: number): string =>
  `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;

const getCurrentDateTimeInTimeZone = (timeZone: string) => {
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return {
    currentDate: dateFormatter.format(new Date()),
    currentTime: timeFormatter.format(new Date()),
  };
};

@Injectable()
export class AssistantAvailabilityService {
  constructor(
    private readonly availabilityService: AvailabilityService,
    private readonly servicesService: ServicesService,
    private readonly staffService: StaffService,
    private readonly conversationsService: ConversationsService,
  ) {}

  private formatSlotsMessage(params: {
    friendlySlots: string[];
    mode: 'SHOW_HOURS' | 'ALTERNATIVES';
  }): string {
    const { friendlySlots, mode } = params;
    const lines = friendlySlots.map((s) => `- ${s}`).join('\n');

    if (mode === 'SHOW_HOURS') {
      return `Estos son algunos horarios disponibles:\n${lines}\n¿Alguna de estas te funciona o prefieres otra hora?`;
    }

    return `No tengo disponibilidad a esa hora, pero te propongo estos horarios disponibles:\n${lines}\n¿Cuál te queda mejor o quieres intentar otra hora?`;
  }

  async handleAvailability(params: {
    input: AssistantChatDto;
    conversation: Conversation;
    historyMessages: ChatCompletionMessageParam[];
    promptContext: AssistantPromptContext;
    reply: string;
    entities: AssistantParsedResponse['entities'] | undefined;
    action: string | undefined;
  }): Promise<{
    handled: boolean;
    finalReply: string;
    finalEntities?: AssistantParsedResponse['entities'];
    finalAction?: string;
    bookingData?: {
      serviceIds: string[];
      staffId?: string;
      date: string;
      time: string;
    };
    isAvailable?: boolean;
  }> {
    const { input, conversation, promptContext, reply, entities, action } =
      params;

    if (conversation.currentState === ConversationState.BOOKING_COMPLETE) {
      return {
        handled: false,
        finalReply: reply,
        finalEntities: entities || {},
        finalAction: action || undefined,
      };
    }

    const isShowHours = action === 'SHOW_HOURS';

    if (!entities) {
      return {
        handled: false,
        finalReply: reply,
        finalEntities: {},
        finalAction: action || undefined,
      };
    }

    // Para SHOW_HOURS, no se requiere hora específica (solo servicio + fecha)
    if (isShowHours) {
      const hasServices =
        Array.isArray(entities.services) && entities.services.length > 0;
      const hasDate =
        typeof entities.date === 'string' && entities.date.length > 0;
      if (!hasServices || !hasDate) {
        return {
          handled: false,
          finalReply: reply,
          finalEntities: entities || {},
          finalAction: action || undefined,
        };
      }
    } else if (!hasAvailabilityEntities(entities)) {
      return {
        handled: false,
        finalReply: reply,
        finalEntities: entities || {},
        finalAction: action || undefined,
      };
    }

    const serviceIds = await mapServices(
      entities.services || [],
      input.tenantId,
      this.servicesService,
    );
    const staffId = await mapStaff(
      entities.staff ?? null,
      input.tenantId,
      this.staffService,
    );

    if (serviceIds.length === 0) {
      return {
        handled: false,
        finalReply: reply,
        finalEntities: entities || {},
        finalAction: action || undefined,
      };
    }

    // Si el usuario pide una hora fuera del horario del local, aclara que está cerrado
    // (no es falta de barberos) y propone el siguiente día.
    if (
      typeof entities.date === 'string' &&
      typeof entities.time === 'string'
    ) {
      const requestedMinutes = parseTimeToMinutes(entities.time);
      const dayOfWeek = getIsoDayOfWeek(entities.date);
      if (requestedMinutes !== null && dayOfWeek !== null) {
        const schedule = parseBusinessHoursForDay(
          promptContext.businessHours,
          dayOfWeek,
        );
        if (schedule) {
          const { currentDate, currentTime } = getCurrentDateTimeInTimeZone(
            promptContext.timezone,
          );
          const isToday = entities.date === currentDate;
          const currentMinutes = parseTimeToMinutes(currentTime);
          const endText = formatMinutesToTime(schedule.endMinutes);
          const startText = formatMinutesToTime(schedule.startMinutes);

          if (
            isToday &&
            currentMinutes !== null &&
            currentMinutes >= schedule.endMinutes
          ) {
            return {
              handled: true,
              finalReply: `Hoy ya cerramos (atendemos hasta las ${endText}). Si quieres, te ayudo a dejarla para mañana: dime el servicio, el barbero y la hora que prefieres.`,
              finalEntities: entities,
              finalAction: action,
              isAvailable: false,
            };
          }

          if (requestedMinutes > schedule.endMinutes) {
            return {
              handled: true,
              finalReply: `A esa hora ya cerramos hoy (atendemos hasta ${endText}). Si quieres, te ayudo a agendar para mañana: dime el servicio, el barbero y la hora que prefieres.`,
              finalEntities: entities,
              finalAction: action,
              isAvailable: false,
            };
          }

          if (requestedMinutes < schedule.startMinutes) {
            return {
              handled: true,
              finalReply: `A esa hora aún no estamos atendiendo (hoy abrimos a las ${startText}). Si quieres, te ayudo a dejarla para más tarde o para mañana: dime el servicio, el barbero y la hora que prefieres.`,
              finalEntities: entities,
              finalAction: action,
              isAvailable: false,
            };
          }
        }
      }
    }

    const availabilityKey = buildAvailabilityKey(
      serviceIds,
      staffId,
      entities.date || '',
      entities.time || '',
    );
    const currentContext = conversation.contextJson ?? {};
    const lastKey =
      typeof currentContext.lastAvailabilityKey === 'string'
        ? currentContext.lastAvailabilityKey
        : undefined;
    const lastIsAvailable =
      typeof currentContext.lastAvailabilityIsAvailable === 'boolean'
        ? currentContext.lastAvailabilityIsAvailable
        : undefined;

    if (!isShowHours && lastKey === availabilityKey) {
      await this.conversationsService.update(conversation.id, {
        contextJson: {
          ...currentContext,
          lastAvailabilityKey: availabilityKey,
        },
      });
      return {
        handled: true,
        finalReply: reply,
        finalEntities: entities || {},
        finalAction: action || undefined,
        bookingData: {
          serviceIds,
          staffId,
          date: entities.date || '',
          time: entities.time || '',
        },
        isAvailable: lastIsAvailable,
      };
    }

    try {
      const availability = await this.availabilityService.findAvailableSlots({
        tenantId: input.tenantId,
        serviceIds,
        desiredDate: entities.date || '',
        desiredTime: entities.time || '',
        staffId,
      });

      const friendly: {
        isAvailable: boolean;
        friendlySlots: string[];
      } = await this.availabilityService.getFriendlySlotsFromAvailability(
        availability,
        input.tenantId,
      );

      const requestedTimeAvailable: boolean = friendly.friendlySlots.includes(
        entities.time || '',
      );
      const hasAvailability: boolean =
        availability.isAvailable && friendly.friendlySlots.length > 0;

      // Nunca pidas al modelo "mostrar horarios" si la lista está vacía:
      // aunque el prompt diga "no inventes", terminan saliendo horas inventadas.
      if (friendly.friendlySlots.length === 0) {
        const staffHint = staffId ? ' con ese barbero' : '';
        const dateHint =
          typeof entities.date === 'string' && entities.date.length > 0
            ? ` para ${entities.date}`
            : '';
        const { currentDate } = getCurrentDateTimeInTimeZone(
          promptContext.timezone,
        );
        const { currentTime } = getCurrentDateTimeInTimeZone(
          promptContext.timezone,
        );
        const currentMinutes = parseTimeToMinutes(currentTime);
        const isToday = entities.date === currentDate;
        const dayOfWeek =
          typeof entities.date === 'string'
            ? getIsoDayOfWeek(entities.date)
            : null;
        const schedule =
          dayOfWeek !== null
            ? parseBusinessHoursForDay(promptContext.businessHours, dayOfWeek)
            : null;
        const isClosedToday = Boolean(
          isToday &&
          schedule &&
          currentMinutes !== null &&
          currentMinutes >= schedule.endMinutes,
        );

        await this.conversationsService.update(conversation.id, {
          currentState: ConversationState.SUGGEST_SLOTS,
          contextJson: {
            ...currentContext,
            lastAvailabilityKey: availabilityKey,
            lastAvailabilityIsAvailable: false,
          },
        });

        const reply = isClosedToday
          ? `Hoy ya cerramos${dateHint}. Si quieres, te ayudo a dejarla para mañana: dime el servicio, el barbero y la hora que prefieres.`
          : staffId
            ? `Uy, hoy ya no tengo cupos${staffHint}${dateHint}. ¿Quieres que te busque con otro barbero o sin preferencia, o prefieres agendar para mañana?`
            : `Uy, hoy ya no tengo cupos${dateHint}. ¿Prefieres agendar para mañana o te sirve otra hora/fecha?`;

        return {
          handled: true,
          finalReply: reply,
          finalEntities: staffId
            ? { ...entities, staff: 'sin preferencia' }
            : entities,
          finalAction: action,
          bookingData: {
            serviceIds,
            staffId: undefined,
            date: entities.date || '',
            time: entities.time || '',
          },
          isAvailable: false,
        };
      }

      if (hasAvailability && requestedTimeAvailable) {
        await this.conversationsService.update(conversation.id, {
          currentState: ConversationState.CONFIRM_APPOINTMENT,
          contextJson: {
            ...currentContext,
            lastAvailabilityKey: availabilityKey,
            lastAvailabilityIsAvailable: true,
          },
        });
        return {
          handled: true,
          finalReply: reply,
          finalEntities: entities,
          finalAction: action,
          bookingData: {
            serviceIds,
            staffId,
            date: entities.date || '',
            time: entities.time || '',
          },
          isAvailable: true,
        };
      }

      if (action === 'SHOW_HOURS' && hasAvailability) {
        const showReply = this.formatSlotsMessage({
          friendlySlots: friendly.friendlySlots,
          mode: 'SHOW_HOURS',
        });

        await this.conversationsService.update(conversation.id, {
          currentState: ConversationState.SUGGEST_SLOTS,
          contextJson: {
            ...currentContext,
            lastAvailabilityKey: availabilityKey,
            lastAvailabilityIsAvailable: true,
          },
        });

        return {
          handled: true,
          finalReply: showReply,
          finalEntities: entities || {},
          finalAction: action || undefined,
          bookingData: {
            serviceIds,
            staffId,
            date: entities.date || '',
            time: entities.time || '',
          },
          isAvailable: true,
        };
      }

      // Si el usuario pidió un barbero específico pero no hay disponibilidad,
      // y vamos a proponer horarios alternativos, debemos limpiar la preferencia
      // para no terminar agendando/mostrando el mismo barbero en el resumen.
      const shouldDropStaffPreference = Boolean(staffId);
      const mergedEntities = shouldDropStaffPreference
        ? { ...entities, staff: 'sin preferencia' }
        : entities;
      const finalReply = this.formatSlotsMessage({
        friendlySlots: friendly.friendlySlots,
        mode: 'ALTERNATIVES',
      });

      await this.conversationsService.update(conversation.id, {
        currentState: ConversationState.SUGGEST_SLOTS,
        contextJson: {
          ...currentContext,
          lastAvailabilityKey: availabilityKey,
          lastAvailabilityIsAvailable: false,
        },
      });

      return {
        handled: true,
        finalReply,
        finalEntities: mergedEntities,
        finalAction: action,
        bookingData: {
          serviceIds,
          staffId: shouldDropStaffPreference ? undefined : staffId,
          date: entities.date || '',
          time: entities.time || '',
        },
        isAvailable: false,
      };
    } catch (error) {
      console.error('Error handling availability:', error);
      return {
        handled: false,
        finalReply:
          'Hubo un problema al verificar la disponibilidad. Por favor, intenta nuevamente.',
        finalEntities: entities,
        finalAction: action,
      };
    }
  }

  async resolveBookingData(params: {
    tenantId: string;
    entities: AssistantParsedResponse['entities'] | undefined;
  }): Promise<
    | {
        serviceIds: string[];
        staffId?: string;
        date: string;
        time: string;
      }
    | undefined
  > {
    const { tenantId, entities } = params;
    if (!hasAvailabilityEntities(entities)) return undefined;
    const serviceIds = await mapServices(
      entities.services,
      tenantId,
      this.servicesService,
    );
    const staffId = await mapStaff(
      entities.staff ?? null,
      tenantId,
      this.staffService,
    );
    if (serviceIds.length === 0) return undefined;
    return {
      serviceIds,
      staffId,
      date: entities.date,
      time: entities.time,
    };
  }
}
