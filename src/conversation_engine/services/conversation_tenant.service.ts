import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Service } from '../../services/entities/service.entity';
import { BusinessHour } from '../../business_hours/entities/business_hour.entity';
import { Staff } from '../../staff/entities/staff.entity';

@Injectable()
export class ConversationTenantService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(BusinessHour)
    private readonly businessHourRepository: Repository<BusinessHour>,
    @InjectRepository(Staff)
    private readonly staffRepository: Repository<Staff>,
  ) {}

  // Obtiene el tenant para personalizar el prompt.
  findTenant(tenantId: string) {
    return this.tenantRepository.findOneBy({ id: tenantId });
  }

  // Obtiene los servicios activos para el prompt.
  async findActiveServiceNames(tenantId: string): Promise<string[]> {
    const services = await this.serviceRepository.find({
      where: { tenantId, isActive: true },
      order: { name: 'ASC' },
    });
    return services.map((service) => service.name);
  }

  async findBusinessHours(tenantId: string): Promise<BusinessHour[]> {
    return this.businessHourRepository.find({
      where: { tenantId },
      order: { dayOfWeek: 'ASC', startTime: 'ASC' },
    });
  }

  async findActiveStaffNames(tenantId: string): Promise<string[]> {
    const staffList = await this.staffRepository.find({
      where: { tenantId, isActive: true },
      order: { name: 'ASC' },
    });
    return staffList.map((staff) => staff.name);
  }
}
