import { Module } from '@nestjs/common';

import { AppointmentsModule } from '../appointments/appointments.module';
import { AvailabilityModule } from '../availability/availability.module';
import { BusinessHoursModule } from '../business_hours/business_hours.module';
import { ClientsModule } from '../clients/clients.module';
import { ServicesModule } from '../services/services.module';
import { BusinessPhotosModule } from '../business-photos/business-photos.module';
import { CustomerAccountsModule } from '../customer-accounts/customer-accounts.module';
import { TenantsModule } from '../tenants/tenants.module';
import { PublicBookingController } from './public-booking.controller';
import { PublicBookingService } from './public-booking.service';

/**
 * El módulo no declara ni una entidad propia y no tiene repositorios.
 *
 * Es la forma de que se note en la estructura lo que dice el servicio: la
 * página pública no es un segundo sistema de reservas, es otra puerta al mismo.
 * El día que este módulo necesite un `TypeOrmModule.forFeature`, algo se está
 * duplicando. Las fotos entran por `BusinessPhotosModule` por esa misma razón:
 * la galería se lee por donde la escribe el panel.
 */
@Module({
  imports: [
    TenantsModule,
    ServicesModule,
    BusinessHoursModule,
    AvailabilityModule,
    ClientsModule,
    AppointmentsModule,
    BusinessPhotosModule,
    CustomerAccountsModule,
  ],
  controllers: [PublicBookingController],
  providers: [PublicBookingService],
})
export class PublicBookingModule {}
