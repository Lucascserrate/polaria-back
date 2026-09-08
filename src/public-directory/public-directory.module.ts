import { Module } from '@nestjs/common';

import { BusinessPhotosModule } from '../business-photos/business-photos.module';
import { ServicesModule } from '../services/services.module';
import { TenantsModule } from '../tenants/tenants.module';
import { PublicDirectoryController } from './public-directory.controller';
import { PublicDirectoryService } from './public-directory.service';

/**
 * Sin entidades propias, igual que `PublicBookingModule`: el buscador no es un
 * segundo catálogo de negocios, es otra lectura del mismo. Ver el servicio.
 */
@Module({
  imports: [TenantsModule, ServicesModule, BusinessPhotosModule],
  controllers: [PublicDirectoryController],
  providers: [PublicDirectoryService],
})
export class PublicDirectoryModule {}
