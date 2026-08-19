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

  /**
   * Salud de la conexión de WhatsApp según Meta.
   *
   * No pasa por `UpdateTenantDto` a propósito: no es algo que el negocio edite
   * desde el panel, sino un dato que llega por webhook. Exponerlo en el PATCH
   * del tenant permitiría marcar una conexión como caída desde afuera.
   */
  async setWhatsappUnavailability(params: {
    tenantId: string;
    since: Date | null;
    reason: string | null;
  }): Promise<void> {
    await this.tenantRepository.update(params.tenantId, {
      whatsappUnavailableSince: params.since,
      whatsappUnavailableReason: params.reason,
    });
  }

  /** Único camino para resolver el tenant de un webhook `account_update`. */
  findByWhatsappWabaId(whatsappWabaId: string): Promise<Tenant | null> {
    return this.tenantRepository.findOneBy({ whatsappWabaId });
  }

  findByWhatsappPhoneId(whatsappPhoneId: string): Promise<Tenant | null> {
    return this.tenantRepository.findOneBy({ whatsappPhoneId });
  }

  findByWhatsappPhoneNumber(
    whatsappPhoneNumber: string,
  ): Promise<Tenant | null> {
    return this.tenantRepository.findOneBy({ whatsappPhoneNumber });
  }

  async setGoogleId(id: string, googleId: string) {
    await this.tenantRepository.update(id, {
      googleId,
    });
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
