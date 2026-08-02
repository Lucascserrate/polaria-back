import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppointmentsModule } from '../appointments/appointments.module';
import { AvailabilityModule } from '../availability/availability.module';
import { ServicesModule } from '../services/services.module';
import { StaffModule } from '../staff/staff.module';
import { TenantsModule } from '../tenants/tenants.module';
import { BookingFlowService } from './booking-flow.service';
import { BookingSessionCleanupJob } from './booking-session-cleanup.job';
import { BookingSessionService } from './booking-session.service';
import { BookingSession } from './entities/booking-session.entity';

/**
 * Flujo guiado de reservas: sesiones, máquina de estados y orquestación.
 * Agnóstico del transporte; no depende del módulo de WhatsApp.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([BookingSession]),
    AvailabilityModule,
    AppointmentsModule,
    ServicesModule,
    StaffModule,
    TenantsModule,
  ],
  providers: [
    BookingSessionService,
    BookingFlowService,
    BookingSessionCleanupJob,
  ],
  exports: [BookingFlowService, BookingSessionService],
})
export class BookingFlowModule {}
