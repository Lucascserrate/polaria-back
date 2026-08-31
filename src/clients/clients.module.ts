import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

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
 * `Appointment` está por lo mismo: eliminar a un cliente exige contar sus citas,
 * y `AppointmentsModule` importa a este —el resolver le da el cliente a cada
 * reserva—, así que traerlo sería un ciclo.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Client, Tenant, Appointment])],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
