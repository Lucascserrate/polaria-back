import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Service } from './entities/service.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { ServiceCategoriesModule } from '../service-categories/service-categories.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Service, Tenant]),
    // Para validar que la categoría de un servicio sea del mismo negocio.
    ServiceCategoriesModule,
  ],
  controllers: [ServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}
