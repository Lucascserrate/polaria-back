import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppointmentsModule } from '../appointments/appointments.module';
import { AvailabilityModule } from '../availability/availability.module';
import { BookingFlowModule } from '../booking-flow/booking-flow.module';
import { ServicesModule } from '../services/services.module';
import { StaffModule } from '../staff/staff.module';
import { TenantsModule } from '../tenants/tenants.module';
import { FlowBookingService } from './flow-booking.service';
import { FlowEndpointController } from './flow-endpoint.controller';
import { FlowEndpointService } from './flow-endpoint.service';

/**
 * WhatsApp Flows: endpoint cifrado y armado de pantallas.
 *
 * Comparte el dominio con el canal nativo —disponibilidad, asignación,
 * creación— y solo aporta su propia forma de presentarlo.
 */
@Module({
  imports: [
    ConfigModule,
    BookingFlowModule,
    AvailabilityModule,
    AppointmentsModule,
    ServicesModule,
    StaffModule,
    TenantsModule,
  ],
  controllers: [FlowEndpointController],
  providers: [FlowEndpointService, FlowBookingService],
  exports: [FlowEndpointService, FlowBookingService],
})
export class FlowsModule {}
