import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AdminOnly, RolesGuard } from '../auth/guards/roles.guard';
import { Actor, type AuthenticatedActor } from '../auth/actor';
import {
  imageUploadOptions,
  type UploadedImageFile,
} from '../cloudinary/image-upload';
import {
  BusinessPhotosService,
  MAX_BUSINESS_PHOTOS,
} from './business-photos.service';

/**
 * Las fotos del local, desde el panel.
 *
 * Cuelga de `settings/` porque es donde el negocio configura lo suyo, pero
 * tiene controlador propio: son cuatro operaciones sobre una colección, y
 * meterlas en `SettingsController` —que ya atiende horarios, conexión con Meta
 * y facturación— haría de ese archivo un índice de todo lo que existe.
 *
 * `@AdminOnly`: las fotos son la cara pública del negocio. Un profesional
 * puede ver su agenda; publicar una foto en la página de reservas es otra cosa.
 */
@ApiTags('settings')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@AdminOnly()
@Controller('settings/photos')
export class BusinessPhotosController {
  constructor(private readonly photosService: BusinessPhotosService) {}

  @Get()
  list(@Actor() actor: AuthenticatedActor) {
    return this.photosService.gallery(actor.tenantId);
  }

  /**
   * Agrega fotos. `multipart/form-data`, campo `files`, varias por petición.
   *
   * Varias de una vez porque así es como se cargan: alguien elige cinco fotos
   * del carrete y las manda. Una petición por archivo dejaría la galería a
   * medio llenar cada vez que se corta la señal a mitad de camino.
   *
   * Responde la galería completa y en orden, no solo lo que se agregó: es lo
   * que el panel necesita para redibujar sin combinar su estado con la
   * respuesta, que es donde aparecen las listas duplicadas.
   */
  @Post()
  @UseInterceptors(
    FilesInterceptor(
      'files',
      MAX_BUSINESS_PHOTOS,
      imageUploadOptions(MAX_BUSINESS_PHOTOS),
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
      required: ['files'],
    },
  })
  add(
    @Actor() actor: AuthenticatedActor,
    @UploadedFiles() files: UploadedImageFile[] | undefined,
  ) {
    return this.photosService.addMany(actor.tenantId, files);
  }

  /**
   * Pone esta foto como portada: la que se ve grande en la página.
   *
   * `PATCH` sobre la foto y no un `PUT` con la lista ordenada completa: lo que
   * el negocio decide es cuál va primero. Mandar el orden entero desde el
   * navegador convertiría dos pestañas abiertas en un reordenamiento que pisa
   * al otro.
   */
  @Patch(':photoId/cover')
  setCover(
    @Actor() actor: AuthenticatedActor,
    @Param('photoId') photoId: string,
  ) {
    return this.photosService.setCover(actor.tenantId, photoId);
  }

  @Delete(':photoId')
  remove(
    @Actor() actor: AuthenticatedActor,
    @Param('photoId') photoId: string,
  ) {
    return this.photosService.remove(actor.tenantId, photoId);
  }
}
