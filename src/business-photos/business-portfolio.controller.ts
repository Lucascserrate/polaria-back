import {
  Controller,
  Delete,
  Get,
  Param,
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
  MAX_PORTFOLIO_PHOTOS,
} from './business-photos.service';

/**
 * El portfolio del negocio: los trabajos terminados.
 *
 * Controlador aparte del de la galería, sobre el mismo servicio. Podría haber
 * sido un parámetro en la ruta —`settings/photos/:kind`— y no lo es porque eso
 * convertiría `gallery` en un valor que viaja desde el navegador: un `kind`
 * escrito a mano alcanzaría para subir al portfolio desde el formulario del
 * local, o para borrar a través del endpoint equivocado. Acá el uso lo fija el
 * servidor y no hay forma de pedir otro.
 *
 * No tiene `cover`: en el portfolio ninguna foto representa al resto, así que
 * el orden es el de carga y no hay nada que elegir. Es la única operación que
 * la galería tiene y esto no.
 */
@ApiTags('settings')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@AdminOnly()
@Controller('settings/portfolio')
export class BusinessPortfolioController {
  constructor(private readonly photosService: BusinessPhotosService) {}

  @Get()
  list(@Actor() actor: AuthenticatedActor) {
    return this.photosService.gallery(actor.tenantId, 'portfolio');
  }

  @Post()
  @UseInterceptors(
    FilesInterceptor(
      'files',
      MAX_PORTFOLIO_PHOTOS,
      imageUploadOptions(MAX_PORTFOLIO_PHOTOS),
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
    return this.photosService.addMany(actor.tenantId, 'portfolio', files);
  }

  @Delete(':photoId')
  remove(
    @Actor() actor: AuthenticatedActor,
    @Param('photoId') photoId: string,
  ) {
    return this.photosService.remove(actor.tenantId, 'portfolio', photoId);
  }
}
