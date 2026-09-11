import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { BusinessPhoto } from './entities/business-photo.entity';
import { BusinessPhotosController } from './business-photos.controller';
import { BusinessPortfolioController } from './business-portfolio.controller';
import { BusinessPhotosService } from './business-photos.service';

/**
 * Se exporta el servicio porque la página pública también lee la galería
 * (`PublicBookingModule`), y tiene que leerla por el mismo camino que la
 * escribe el panel: dos consultas distintas a la misma tabla son dos lugares
 * donde el orden de las fotos puede terminar siendo distinto.
 */
@Module({
  imports: [TypeOrmModule.forFeature([BusinessPhoto]), CloudinaryModule],
  controllers: [BusinessPhotosController, BusinessPortfolioController],
  providers: [BusinessPhotosService],
  exports: [BusinessPhotosService],
})
export class BusinessPhotosModule {}
