import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Request } from 'express';

import type { JwtPayload } from './actor';
import { runImpersonated } from './impersonation';

/**
 * Marca toda la petición como suplantada, si el token lo dice.
 *
 * Va como interceptor y no como middleware porque necesita el token ya
 * verificado: un middleware corre antes de los guards, cuando `request.user`
 * todavía no existe, y tendría que volver a validar el JWT por su cuenta.
 *
 * La suscripción se abre **dentro** de `runImpersonated`, no afuera: el handler
 * de la ruta se ejecuta cuando alguien se suscribe al observable, así que
 * envolver solo la llamada a `next.handle()` dejaría al handler corriendo fuera
 * del contexto y el bloqueo no se aplicaría a nada.
 */
@Injectable()
export class ImpersonationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>();

    const payload = request.user;
    if (!payload?.imp) return next.handle();

    const impersonation = {
      by: payload.act ?? 'desconocido',
      tenantId: payload.sub,
    };

    return new Observable((subscriber) =>
      runImpersonated(impersonation, () => next.handle().subscribe(subscriber)),
    );
  }
}
