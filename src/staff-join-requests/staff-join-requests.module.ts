import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StaffJoinRequest } from './entities/staff-join-request.entity';
import {
  SignupJoinController,
  StaffJoinRequestsController,
} from './staff-join-requests.controller';
import { StaffJoinRequestsService } from './staff-join-requests.service';
import { AuthModule } from '../auth/auth.module';
import { StaffModule } from '../staff/staff.module';
import { TenantsModule } from '../tenants/tenants.module';

/**
 * Dos controladores sobre un servicio: el que pide y el que resuelve.
 *
 * Están juntos porque son las dos mitades de la misma operación —un pedido no
 * significa nada sin alguien que lo apruebe— y separarlos en dos módulos habría
 * dejado la regla de qué pasa al aprobar repartida en dos lugares.
 *
 * `AuthModule` entra por `SignupGuard`, que es lo que autoriza el lado del que
 * pide y que ese módulo exporta a propósito.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([StaffJoinRequest]),
    AuthModule,
    StaffModule,
    TenantsModule,
  ],
  controllers: [SignupJoinController, StaffJoinRequestsController],
  providers: [StaffJoinRequestsService],
})
export class StaffJoinRequestsModule {}
