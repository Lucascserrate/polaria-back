import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Staff } from './entities/staff.entity';
import { StaffSchedule } from './entities/staff_schedule.entity';
import { Service } from '../services/entities/service.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { AppointmentService as AppointmentServiceEntity } from '../appointments/entities/appointment_service.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Staff,
      StaffSchedule,
      Service,
      Appointment,
      AppointmentServiceEntity,
      Tenant,
    ]),
  ],
  controllers: [StaffController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}
