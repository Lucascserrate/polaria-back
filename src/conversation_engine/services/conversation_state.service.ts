import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversationState } from '../../conversations/entities/conversation.entity';
import { Service } from '../../services/entities/service.entity';
import { Staff } from '../../staff/entities/staff.entity';

@Injectable()
export class ConversationStateService {
  constructor(
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(Staff)
    private readonly staffRepository: Repository<Staff>,
  ) {}

  // Resuelve el estado segun el mensaje del usuario.
  async resolveState(input: { tenantId: string; message: string }) {
    const normalized = normalizeMessage(input.message);
    if (!normalized) {
      return ConversationState.IDLE;
    }
    if (isGreeting(normalized)) {
      return ConversationState.IDLE;
    }

    const hasService = await this.hasServiceMention(input.tenantId, normalized);
    if (!hasService) {
      return ConversationState.ASK_SERVICE;
    }

    const hasDate = Boolean(parseDatePreference(normalized));
    if (!hasDate) {
      return ConversationState.ASK_SLOT;
    }

    const hasTime = Boolean(parseHourPreference(normalized));
    if (!hasTime) {
      return ConversationState.ASK_SLOT;
    }

    return ConversationState.CONFIRM_APPOINTMENT;
  }

  async findServiceMatch(
    tenantId: string,
    message: string,
  ): Promise<Service | null> {
    const matches = await this.findServiceMatches(tenantId, message);
    return matches[0] ?? null;
  }

  async findServiceMatches(
    tenantId: string,
    message: string,
  ): Promise<Service[]> {
    const services = await this.serviceRepository.find({
      where: { tenantId, isActive: true },
    });
    const normalized = normalizeMessage(message);
    return services.filter((service) =>
      normalized.includes(normalizeMessage(service.name)),
    );
  }

  async findStaffMatch(
    tenantId: string,
    message: string,
  ): Promise<Staff | null> {
    const matches = await this.findStaffMatches(tenantId, message);
    return matches[0] ?? null;
  }

  async findStaffMatches(tenantId: string, message: string): Promise<Staff[]> {
    const staffList = await this.staffRepository.find({
      where: { tenantId, isActive: true },
    });
    const normalized = normalizeMessage(message);
    return staffList.filter((staff) =>
      normalized.includes(normalizeMessage(staff.name)),
    );
  }

  private async hasServiceMention(
    tenantId: string,
    message: string,
  ): Promise<boolean> {
    const match = await this.findServiceMatch(tenantId, message);
    return Boolean(match);
  }

  async getServiceDurationMinutes(tenantId: string, serviceId: string) {
    const service = await this.serviceRepository.findOneBy({
      id: serviceId,
      tenantId,
      isActive: true,
    });
    return service?.durationMinutes ?? null;
  }

  async getServicesDurationMinutes(tenantId: string, serviceIds: string[]) {
    if (!serviceIds.length) {
      return null;
    }
    const services = await this.serviceRepository.find({
      where: serviceIds.map((id) => ({
        id,
        tenantId,
        isActive: true,
      })),
    });
    if (!services.length || services.length !== serviceIds.length) {
      return null;
    }
    return services.reduce((sum, service) => sum + service.durationMinutes, 0);
  }
}

function normalizeMessage(message: string) {
  return message
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isGreeting(normalizedMessage: string) {
  const greetings = new Set([
    'hola',
    'buenas',
    'buenos dias',
    'buenas tardes',
    'buenas noches',
    'hey',
    'que tal',
  ]);
  return greetings.has(normalizedMessage);
}

function parseDatePreference(message: string) {
  if (message.includes('hoy')) {
    return true;
  }
  if (message.includes('pasado manana')) {
    return true;
  }
  if (message.includes('manana')) {
    return true;
  }
  const days = [
    'lunes',
    'martes',
    'miercoles',
    'jueves',
    'viernes',
    'sabado',
    'domingo',
  ];
  return days.some((day) => message.includes(day));
}

function parseHourPreference(message: string) {
  return /(?:a las\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.test(message);
}
