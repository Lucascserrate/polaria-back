import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppointmentsModule } from '../appointments/appointments.module';
import { BusinessPhotosModule } from '../business-photos/business-photos.module';
import { TenantsModule } from '../tenants/tenants.module';
import { CustomerAccount } from './entities/customer-account.entity';
import { BookingClaimService } from './booking-claim';
import { CustomerAccountsService } from './customer-accounts.service';
import { CustomerAppointmentsController } from './customer-appointments.controller';
import { CustomerAppointmentsService } from './customer-appointments.service';
import { CustomerAuthController } from './customer-auth.controller';
import { CustomerGoogleStrategy } from './customer-google.strategy';
import { CustomerGuard, CustomerSessionService } from './customer-session';

/**
 * Las cuentas de quienes reservan, su sesión y los turnos que sacaron con ella.
 *
 * `JwtModule.register({})` sin secreto no es un olvido: el de esta sesión se
 * deriva y se pasa en cada firma y en cada verificación, justamente para no
 * heredar el del panel. Ver `customer-session.ts`.
 *
 * Se exportan el servicio y la sesión porque la reserva pública los necesita:
 * cuando hay sesión, el nombre y el teléfono salen de la cuenta y no de lo que
 * mande el navegador.
 *
 * `AppointmentsModule` entra acá —y no al revés— porque la dependencia va en ese
 * sentido: las citas no saben nada de cuentas de Polaria más allá de la columna
 * que guardan, y quien pregunta "¿qué turnos tengo?" es la cuenta.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CustomerAccount]),
    JwtModule.register({}),
    AppointmentsModule,
    BusinessPhotosModule,
    TenantsModule,
  ],
  controllers: [CustomerAuthController, CustomerAppointmentsController],
  providers: [
    BookingClaimService,
    CustomerAccountsService,
    CustomerAppointmentsService,
    CustomerSessionService,
    CustomerGuard,
    CustomerGoogleStrategy,
  ],
  exports: [BookingClaimService, CustomerAccountsService, CustomerSessionService],
})
export class CustomerAccountsModule {}
