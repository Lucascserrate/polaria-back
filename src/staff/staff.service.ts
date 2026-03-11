import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Staff } from './entities/staff.entity';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

@Injectable()
export class StaffService {
  constructor(
    @InjectRepository(Staff)
    private staffRepository: Repository<Staff>,
  ) {}

  create(createStaffDto: CreateStaffDto) {
    const staff = this.staffRepository.create(createStaffDto);
    return this.staffRepository.save(staff);
  }

  findAll() {
    return this.staffRepository.find();
  }

  findOne(id: string) {
    return this.staffRepository.findOneBy({ id });
  }

  async update(id: string, updateStaffDto: UpdateStaffDto) {
    await this.staffRepository.update(id, updateStaffDto);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.staffRepository.delete(id);
    return { deleted: true };
  }
}
