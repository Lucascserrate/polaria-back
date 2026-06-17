import { Injectable } from '@nestjs/common';
import { BusinessHoursService } from '../../business_hours/business_hours.service';
import { ServicesService } from '../../services/services.service';
import { StaffService } from '../../staff/staff.service';
import { TenantsService } from '../../tenants/tenants.service';
import type { BusinessHour } from '../../business_hours/entities/business_hour.entity';
import type { Service } from '../../services/entities/service.entity';
import type { Staff } from '../../staff/entities/staff.entity';
import type { Tenant } from '../../tenants/entities/tenant.entity';
import type { AssistantPromptContext } from '../prompts/assistant.system';

@Injectable()
export class AssistantPromptContextService {
  private readonly cache = new Map<
    string,
    {
      expiresAt: number;
      context: Omit<AssistantPromptContext, 'currentDateTime' | 'clientName'>;
    }
  >();
  private readonly cacheTtlMs = 5 * 60 * 1000;

  constructor(
    private readonly businessHoursService: BusinessHoursService,
    private readonly servicesService: ServicesService,
    private readonly staffService: StaffService,
    private readonly tenantsService: TenantsService,
  ) {}

  async build(
    tenantId?: string,
    clientName?: string,
    conversationState?: string,
    storedEntitiesJson?: string,
  ): Promise<AssistantPromptContext> {
    if (!tenantId) {
      throw new Error('TenantId is required');
    }

    const now = Date.now();
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > now) {
      return {
        ...cached.context,
        currentDateTime: this.formatNow(cached.context.timezone),
        currentDate: this.formatCurrentDate(cached.context.timezone),
        currentTime: this.formatCurrentTime(cached.context.timezone),
        isClosedNow: this.isClosedNow(
          cached.context.businessHours,
          cached.context.timezone,
        ),
        clientName,
        conversationState,
        storedEntitiesJson,
      };
    }

    const tenant: Tenant | null = await this.tenantsService.findOne(tenantId);
    const timezone = this.normalizeTimezone(tenant?.timezone);
    const barbershopName = tenant?.name?.trim();
    if (!barbershopName) {
      throw new Error(`Tenant name is required for tenantId=${tenantId}`);
    }

    const [businessHours, services, staff]: [
      BusinessHour[],
      Service[],
      Staff[],
    ] = await Promise.all([
      this.businessHoursService.findByTenant(tenantId),
      this.servicesService.findActiveByTenant(tenantId),
      this.staffService.findByTenant(tenantId),
    ]);

    const businessHoursText = businessHours.map(
      (item) => `Dia ${item.dayOfWeek}: ${item.startTime}-${item.endTime}`,
    );
    const dayNames = [
      'domingo',
      'lunes',
      'martes',
      'miercoles',
      'jueves',
      'viernes',
      'sabado',
    ];
    const businessDaysOpen = [
      ...new Set(businessHours.map((item) => item.dayOfWeek)),
    ]
      .sort((a, b) => a - b)
      .map((day) => dayNames[day] ?? `dia ${day}`);
    const businessHoursHuman = businessHoursText.map((line) => {
      const match = line.match(/^Dia (\d): (\d{2}:\d{2})-(\d{2}:\d{2})$/);
      if (!match) return line;
      const dayIndex = Number(match[1]);
      const dayName = dayNames[dayIndex] ?? `dia ${dayIndex}`;
      return `${dayName}: ${match[2]} - ${match[3]}`;
    });
    const serviceNames = services.map((item) => item.name);
    const servicesCatalog = services.map((item) => ({
      name: item.name,
      price: Number(item.price),
      durationMinutes: item.durationMinutes,
      description: item.description,
    }));

    // Construir staffServices con solo barberos activos y sus servicios
    const staffServices: { [staffName: string]: string[] } = {};
    const activeStaff = staff.filter((item) => item.isActive);

    for (const staffMember of activeStaff) {
      staffServices[staffMember.name] = staffMember.services
        .filter((service) => service.isActive)
        .map((service) => service.name);
    }

    const baseContext = {
      timezone,
      businessHours: businessHoursText,
      businessHoursHuman,
      businessDaysOpen,
      services: serviceNames,
      servicesCatalog,
      staffServices,
      barbershopName,
      currentDate: this.formatCurrentDate(timezone),
      currentTime: this.formatCurrentTime(timezone),
      isClosedNow: this.isClosedNow(businessHoursText, timezone),
    };

    this.cache.set(tenantId, {
      expiresAt: now + this.cacheTtlMs,
      context: baseContext,
    });

    return {
      ...baseContext,
      currentDateTime: this.formatNow(timezone),
      currentDate: this.formatCurrentDate(timezone),
      currentTime: this.formatCurrentTime(timezone),
      isClosedNow: this.isClosedNow(businessHoursText, timezone),
      clientName,
      conversationState,
      storedEntitiesJson,
    };
  }

  private formatNow(timezone: string): string {
    const formatter = new Intl.DateTimeFormat('es-CO', {
      timeZone: timezone,
      dateStyle: 'full',
      timeStyle: 'short',
    });
    return formatter.format(new Date());
  }

  private formatCurrentDate(timezone: string): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  }

  private formatCurrentTime(timezone: string): string {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return formatter.format(new Date());
  }

  private isClosedNow(businessHours: string[], timezone: string): boolean {
    const currentDate = this.formatCurrentDate(timezone);
    const currentTime = this.formatCurrentTime(timezone);
    const currentMinutes = this.parseTimeToMinutes(currentTime);
    const currentDay = this.getIsoDayOfWeek(currentDate);
    if (currentMinutes === null || currentDay === null) return false;

    const targetPrefix = `Dia ${currentDay}:`;
    const line = businessHours.find((item) =>
      item.toLowerCase().trim().startsWith(targetPrefix.toLowerCase()),
    );
    if (!line) return false;

    const match = line.match(/:\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
    if (!match) return false;

    const startMinutes = this.parseTimeToMinutes(match[1]);
    const endMinutes = this.parseTimeToMinutes(match[2]);
    if (startMinutes === null || endMinutes === null) return false;

    return currentMinutes < startMinutes || currentMinutes >= endMinutes;
  }

  private parseTimeToMinutes(raw: string): number | null {
    const match = raw.match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  private getIsoDayOfWeek(isoDate: string): number | null {
    const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, monthIndex, day));
    if (Number.isNaN(date.getTime())) return null;
    return date.getUTCDay();
  }

  private normalizeTimezone(timezone?: string): string {
    const fallback = 'America/La_Paz';
    if (!timezone || timezone.trim().length === 0) {
      return fallback;
    }
    try {
      new Intl.DateTimeFormat('es-CO', { timeZone: timezone }).format(
        new Date(),
      );
      return timezone;
    } catch {
      return fallback;
    }
  }
}
