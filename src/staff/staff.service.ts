import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Staff } from './entities/staff.entity';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { Service } from '../services/entities/service.entity';

@Injectable()
export class StaffService {
  constructor(
    @InjectRepository(Staff)
    private staffRepository: Repository<Staff>,
    @InjectRepository(Service)
    private serviceRepository: Repository<Service>,
  ) {}

  async create(createStaffDto: CreateStaffDto): Promise<Staff> {
    const { serviceIds, ...rest } = createStaffDto;
    const staff = this.staffRepository.create(rest);

    if (serviceIds?.length) {
      const services = await this.serviceRepository.find({
        where: { id: In(serviceIds), tenantId: staff.tenantId },
        order: { name: 'ASC' },
      });
      if (services.length !== serviceIds.length) {
        throw new BadRequestException(
          'One or more services are invalid for this tenant',
        );
      }
      staff.services = services;
    }

    return this.staffRepository.save(staff);
  }

  findAll(): Promise<Staff[]> {
    return this.staffRepository.find({ relations: { services: true } });
  }

  findOne(id: string): Promise<Staff | null> {
    return this.staffRepository.findOne({
      where: { id },
      relations: { services: true },
    });
  }

  findByTenant(tenantId: string): Promise<Staff[]> {
    return this.staffRepository.find({
      where: { tenantId },
      order: { name: 'ASC' },
      relations: { services: true },
    });
  }

  async update(id: string, updateStaffDto: UpdateStaffDto) {
    const staff = await this.staffRepository.findOne({
      where: { id },
      relations: { services: true },
    });
    if (!staff) return null;

    const { serviceIds, ...rest } = updateStaffDto as CreateStaffDto;
    this.staffRepository.merge(staff, rest);

    if (serviceIds) {
      if (!serviceIds.length) {
        staff.services = [];
      } else {
        const services = await this.serviceRepository.find({
          where: { id: In(serviceIds), tenantId: staff.tenantId },
          order: { name: 'ASC' },
        });
        if (services.length !== serviceIds.length) {
          throw new BadRequestException(
            'One or more services are invalid for this tenant',
          );
        }
        staff.services = services;
      }
    }

    await this.staffRepository.save(staff);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.staffRepository.delete(id);
    return { deleted: true };
  }
}
