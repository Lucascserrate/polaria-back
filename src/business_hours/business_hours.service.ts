import { Injectable } from '@nestjs/common';
import { CreateBusinessHourDto } from './dto/create-business_hour.dto';
import { UpdateBusinessHourDto } from './dto/update-business_hour.dto';

@Injectable()
export class BusinessHoursService {
  create(createBusinessHourDto: CreateBusinessHourDto) {
    return 'This action adds a new businessHour';
  }

  findAll() {
    return `This action returns all businessHours`;
  }

  findOne(id: number) {
    return `This action returns a #${id} businessHour`;
  }

  update(id: number, updateBusinessHourDto: UpdateBusinessHourDto) {
    return `This action updates a #${id} businessHour`;
  }

  remove(id: number) {
    return `This action removes a #${id} businessHour`;
  }
}
