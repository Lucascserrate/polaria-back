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

  create(createServiceDto: CreateServiceDto) {
    const service = this.serviceRepository.create(createServiceDto);
    return this.serviceRepository.save(service);
  }

  findAll() {
    return this.serviceRepository.find();
  }

  findOne(id: string) {
    return this.serviceRepository.findOneBy({ id });
  }

  async update(id: string, updateServiceDto: UpdateServiceDto) {
    await this.serviceRepository.update(id, updateServiceDto);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.serviceRepository.delete(id);
    return { deleted: true };
  }
}
