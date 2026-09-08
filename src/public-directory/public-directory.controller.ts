import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { PublicDirectoryService } from './public-directory.service';

/**
 * El listado de negocios, para cualquiera.
 *
 * Sin guard, como el de reservas y por lo mismo: es lo que tiene que poder leer
 * alguien que abre el buscador sin haber iniciado sesión nunca. La diferencia
 * con aquél es que acá no hay slug que acote la respuesta, así que lo que
 * protege el dato es únicamente la forma que arma `PublicDirectoryService`,
 * campo por campo. Un `find` que devolviera entidades publicaría los tokens de
 * Meta de todos los negocios de una sola vez.
 *
 * Es un controlador aparte y no un método más en `PublicBookingController`
 * porque aquél cuelga entero de `public/businesses/:slug` y esto vive un nivel
 * más arriba. Que sean dos controladores también mantiene la regla de aquél
 * intacta: los endpoints bajo un slug siguen siendo tres.
 */
@ApiTags('public-directory')
@Controller('public/businesses')
export class PublicDirectoryController {
  constructor(
    private readonly publicDirectoryService: PublicDirectoryService,
  ) {}

  @Get()
  list() {
    return this.publicDirectoryService.list();
  }
}
