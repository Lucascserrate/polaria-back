import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Tenant } from './entities/tenant.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,
  ) {}

  create(createTenantDto: CreateTenantDto): Promise<Tenant> {
    const tenant = this.tenantRepository.create(createTenantDto);
    return this.tenantRepository.save(tenant);
  }

  findAll(): Promise<Tenant[]> {
    return this.tenantRepository.find();
  }

  findOne(id: string): Promise<Tenant | null> {
    return this.tenantRepository.findOneBy({ id });
  }

  findByGoogleId(googleId: string): Promise<Tenant | null> {
    return this.tenantRepository.findOneBy({ googleId });
  }

  findByEmail(email: string): Promise<Tenant | null> {
    return this.tenantRepository.findOneBy({ email });
  }

  async setGoogleId(id: string, googleId: string) {
    await this.tenantRepository.update(id, { googleId });
    return this.findOne(id);
  }

  async update(id: string, updateTenantDto: UpdateTenantDto) {
    await this.tenantRepository.update(id, updateTenantDto);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.tenantRepository.delete(id);
    return { deleted: true };
  }
}
