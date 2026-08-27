import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { Appointment } from './entities/appointment.entity';
import { AppointmentService as AppointmentServiceEntity } from './entities/appointment_service.entity';
import { Service } from '../services/entities/service.entity';
import { AvailabilityModule } from '../availability/availability.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Appointment, AppointmentServiceEntity, Service]),
    AvailabilityModule,
    // Las citas encolan avisos a los profesionales. La dependencia va en este
    // sentido y no al revés: ver el comentario de `NotificationsModule`.
    NotificationsModule,
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
