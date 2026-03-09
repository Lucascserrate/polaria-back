import { Injectable } from '@nestjs/common';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

@Injectable()
export class StaffService {
  create(createStaffDto: CreateStaffDto) {
    return 'This action adds a new staff';
  }

  findAll() {
    return `This action returns all staff`;
  }

  findOne(id: string) {
    return `This action returns a #${id} staff`;
  }

  update(id: string, updateStaffDto: UpdateStaffDto) {
    return `This action updates a #${id} staff`;
  }

  remove(id: string) {
    return `This action removes a #${id} staff`;
  }
}
