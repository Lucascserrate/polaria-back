import { Module } from '@nestjs/common';
import { BusinessHoursService } from './business_hours.service';
import { BusinessHoursController } from './business_hours.controller';

@Module({
  controllers: [BusinessHoursController],
  providers: [BusinessHoursService],
})
export class BusinessHoursModule {}
