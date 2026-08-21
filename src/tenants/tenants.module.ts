import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Tenant } from './entities/tenant.entity';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';

@Module({
  // El guard se registra acá y no se importa de `AuthModule` porque ese ya
  // importa a este: sería un ciclo. Es una clase sin estado, así que tenerla en
  // los dos inyectores no cambia nada.
  imports: [ConfigModule, TypeOrmModule.forFeature([Tenant])],
  controllers: [TenantsController],
  providers: [TenantsService, SuperAdminGuard],
  exports: [TenantsService],
})
export class TenantsModule {}
