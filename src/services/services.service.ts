import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Service } from './entities/service.entity';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(Service)
    private serviceRepository: Repository<Service>,
  ) {}

  create(createServiceDto: CreateServiceDto): Promise<Service> {
    const service = this.serviceRepository.create(createServiceDto);
    return this.serviceRepository.save(service);
  }

  findByTenant(tenantId: string): Promise<Service[]> {
    return this.serviceRepository.find({
      where: { tenantId },
      order: { name: 'ASC' },
    });
  }

  findOneByTenant(id: string, tenantId: string): Promise<Service | null> {
    return this.serviceRepository.findOne({
      where: { id, tenantId },
    });
  }

  async updateByTenant(
    id: string,
    tenantId: string,
    updateServiceDto: UpdateServiceDto,
  ) {
    await this.serviceRepository.update({ id, tenantId }, updateServiceDto);
    return this.findOneByTenant(id, tenantId);
  }

  async removeByTenant(id: string, tenantId: string) {
    await this.serviceRepository.delete({ id, tenantId });
    return { deleted: true };
  }
}
