import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Appointment } from '../appointments/entities/appointment.entity';
import { BusinessHour } from '../business_hours/entities/business_hour.entity';
import { Service } from '../services/entities/service.entity';
import { Staff } from '../staff/entities/staff.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { AvailabilityController } from './availability.controller';
import { AvailabilityCalculator } from './availability.calculator';
import { AvailabilityRepository } from './availability.repository';
import { AvailabilityService } from './availability.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Appointment,
      BusinessHour,
      Service,
      Staff,
      Tenant,
    ]),
  ],
  controllers: [AvailabilityController],
  providers: [
    AvailabilityService,
    AvailabilityRepository,
    AvailabilityCalculator,
  ],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
