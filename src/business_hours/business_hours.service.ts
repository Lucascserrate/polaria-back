import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BusinessHour } from './entities/business_hour.entity';
import { CreateBusinessHourDto } from './dto/create-business_hour.dto';
import { UpdateBusinessHourDto } from './dto/update-business_hour.dto';

@Injectable()
export class BusinessHoursService {
  constructor(
    @InjectRepository(BusinessHour)
    private businessHourRepository: Repository<BusinessHour>,
  ) {}

  create(createBusinessHourDto: CreateBusinessHourDto) {
    const businessHour =
      this.businessHourRepository.create(createBusinessHourDto);
    return this.businessHourRepository.save(businessHour);
  }

  findAll() {
    return this.businessHourRepository.find();
  }

  findOne(id: string) {
    return this.businessHourRepository.findOneBy({ id });
  }

  async update(id: string, updateBusinessHourDto: UpdateBusinessHourDto) {
    await this.businessHourRepository.update(id, updateBusinessHourDto);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.businessHourRepository.delete(id);
    return { deleted: true };
  }
}
