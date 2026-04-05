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

  async build(tenantId?: string): Promise<AssistantPromptContext> {
    let timezone = 'America/Bogota';
    const currentDateTime = new Date().toISOString();

    if (!tenantId) {
      return {
        timezone,
        currentDateTime,
        businessHours: [],
        services: [],
        staff: [],
      };
    }

    const tenant: Tenant | null = await this.tenantsService.findOne(tenantId);
    if (tenant?.timezone) {
      timezone = tenant.timezone;
    }

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
      currentDateTime,
      businessHours: businessHoursText,
      services: serviceNames,
      staff: staffNames,
    };
  }
}
