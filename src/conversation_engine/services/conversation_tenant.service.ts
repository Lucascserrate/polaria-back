import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Service } from '../../services/entities/service.entity';

@Injectable()
export class ConversationTenantService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
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
}
