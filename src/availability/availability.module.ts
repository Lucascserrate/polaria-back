import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Appointment } from '../appointments/entities/appointment.entity';
import { AppointmentService as AppointmentServiceEntity } from '../appointments/entities/appointment_service.entity';
import { BusinessHour } from '../business_hours/entities/business_hour.entity';
import { Service } from '../services/entities/service.entity';
import { ScheduleBlock } from '../schedule-blocks/entities/schedule-block.entity';
import { Staff } from '../staff/entities/staff.entity';
import { StaffSchedule } from '../staff/entities/staff_schedule.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { AvailabilityController } from './availability.controller';
import { AvailabilityCalculator } from './availability.calculator';
import { AvailabilityRepository } from './availability.repository';
import { AvailabilityService } from './availability.service';
import { BookingAvailabilityService } from './booking/booking-availability.service';
import { SchedulingRulesModule } from '../scheduling-rules/scheduling-rules.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Appointment,
      AppointmentServiceEntity,
      BusinessHour,
      ScheduleBlock,
      Service,
      Staff,
      StaffSchedule,
      Tenant,
    ]),
    /*
     * Las reglas de qué categorías conviven las lee `loadContext` en cada
     * consulta de horarios. Es una dependencia del cálculo, no del panel.
     */
    SchedulingRulesModule,
  ],
  controllers: [AvailabilityController],
  providers: [
    AvailabilityService,
    AvailabilityRepository,
    AvailabilityCalculator,
    BookingAvailabilityService,
  ],
  exports: [AvailabilityService, BookingAvailabilityService],
})
export class AvailabilityModule {}
