import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppointmentsModule } from '../appointments/appointments.module';
import { Appointment } from '../appointments/entities/appointment.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Client } from './entities/client.entity';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';

/**
 * `Tenant` se registra acá y no se importa `TenantsModule` porque lo único que
 * hace falta del negocio es su zona horaria, para deducir el prefijo telefónico
 * del país. Traer el módulo entero arrastraría su controlador, su guard de
 * super-admin y su `ConfigModule` para leer una columna. Mismo criterio que
 * `AvailabilityModule`.
 *
 * `Appointment` como entidad está para contar las citas al eliminar un cliente,
 * que es una cuenta sobre una sola tabla. `AppointmentsModule` entero está para
 * el historial de la ficha, que necesita los joins con servicios y profesionales
 * y su mapeo: reescribirlos acá haría que la ficha y la agenda se separen.
 *
 * La dependencia va en este sentido y **no** al revés. Si algún día las citas
 * necesitaran resolver un cliente, eso es un ciclo: el resolver se le pasa desde
 * afuera, como ya hacen la página pública y el panel.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Client, Tenant, Appointment]),
    AppointmentsModule,
  ],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
