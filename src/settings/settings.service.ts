import { Injectable, NotFoundException } from '@nestjs/common';
import { BusinessHoursService } from '../business_hours/business_hours.service';
import { TenantsService } from '../tenants/tenants.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

type SettingsResponse = {
  polariaName: string;
  workingDays: boolean[];
  openingHours: { from: string; to: string } | null;
  aiEnabled: boolean;
};

@Injectable()
export class SettingsService {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly businessHoursService: BusinessHoursService,
  ) {}

  async getSettings(tenantId: string): Promise<SettingsResponse> {
    const tenant = await this.tenantsService.findOne(tenantId);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const { workingDays, openingHours } =
      await this.businessHoursService.getTenantHoursSettings(tenantId);

    return {
      polariaName: tenant.name,
      workingDays,
      openingHours,
      aiEnabled: tenant.aiEnabled,
    };
  }

  async updateSettings(
    tenantId: string,
    dto: UpdateSettingsDto,
  ): Promise<SettingsResponse> {
    const tenant = await this.tenantsService.findOne(tenantId);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    if (dto.polariaName && dto.polariaName !== tenant.name) {
      await this.tenantsService.update(tenantId, {
        name: dto.polariaName,
      });
    }

    if (
      typeof dto.aiEnabled === 'boolean' &&
      dto.aiEnabled !== tenant.aiEnabled
    ) {
      await this.tenantsService.update(tenantId, {
        aiEnabled: dto.aiEnabled,
      });
    }

    await this.businessHoursService.updateTenantHoursSettings(tenantId, {
      workingDays: dto.workingDays,
      openingHours: dto.openingHours,
    });

    return this.getSettings(tenantId);
  }
}
