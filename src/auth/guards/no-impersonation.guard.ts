import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

import type { JwtPayload } from '../actor';

/**
 * Cierra una ruta a las sesiones de soporte.
 *
 * El bloqueo general vive en `WhatsAppSenderService`, donde tapa todo lo que
 * sale hacia afuera sin que haya que acordarse ruta por ruta. Este guard es para
 * lo otro: lo que no manda ningún mensaje pero **no se puede deshacer**, como
 * soltar la conexión con Meta. Ahí no alcanza con que no salga nada; hace falta
 * que la petición no ocurra, y que quien la intentó entienda por qué.
 *
 * Es deliberadamente una lista corta y explícita. Un bloqueo amplio convertiría
 * la suplantación en una vista de solo lectura, que es justo lo que no sirve
 * cuando entrás a arreglarle algo a un negocio.
 */
@Injectable()
export class NoImpersonationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>();

    if (request.user?.imp) {
      throw new ForbiddenException(
        'Esta acción no se puede hacer desde una sesión de soporte. Salí de la sesión y pedísela al negocio.',
      );
    }

    return true;
  }
}
