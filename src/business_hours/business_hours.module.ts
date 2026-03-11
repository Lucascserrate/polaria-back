import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BusinessHour } from './entities/business_hour.entity';
import { BusinessHoursService } from './business_hours.service';
import { BusinessHoursController } from './business_hours.controller';

@Module({
  imports: [TypeOrmModule.forFeature([BusinessHour])],
  controllers: [BusinessHoursController],
  providers: [BusinessHoursService],
})
export class BusinessHoursModule {}
