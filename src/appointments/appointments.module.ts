import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { Appointment } from './entities/appointment.entity';
import { AppointmentService as AppointmentServiceEntity } from './entities/appointment_service.entity';
import { Service } from '../services/entities/service.entity';
import { AvailabilityModule } from '../availability/availability.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Appointment, AppointmentServiceEntity, Service]),
    AvailabilityModule,
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
