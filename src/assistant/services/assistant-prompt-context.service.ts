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
  constructor(
    private readonly businessHoursService: BusinessHoursService,
    private readonly servicesService: ServicesService,
    private readonly staffService: StaffService,
    private readonly tenantsService: TenantsService,
  ) {}

  async build(
    tenantId?: string,
    clientName?: string,
  ): Promise<AssistantPromptContext> {
    if (!tenantId) {
      throw new Error('TenantId is required');
    }

    const tenant: Tenant | null = await this.tenantsService.findOne(tenantId);
    const timezone = this.normalizeTimezone(tenant?.timezone);

    const [businessHours, services, staff]: [
      BusinessHour[],
      Service[],
      Staff[],
    ] = await Promise.all([
      this.businessHoursService.findByTenant(tenantId),
      this.servicesService.findByTenant(tenantId),
      this.staffService.findByTenant(tenantId),
    ]);

    const businessHoursText = businessHours.map(
      (item) => `Dia ${item.dayOfWeek}: ${item.startTime}-${item.endTime}`,
    );
    const serviceNames = services.map((item) => item.name);
    const staffNames = staff.map((item) => item.name);

    return {
      timezone,
      currentDateTime: this.formatNow(timezone),
      businessHours: businessHoursText,
      services: serviceNames,
      staff: staffNames,
      clientName,
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
