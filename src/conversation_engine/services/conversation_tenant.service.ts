import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

@Injectable()
export class ConversationTenantService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
  ) {}

  // Obtiene el tenant para personalizar el prompt.
  findTenant(tenantId: string) {
    return this.tenantRepository.findOneBy({ id: tenantId });
  }
}
