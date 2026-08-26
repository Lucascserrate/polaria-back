import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { actorFrom, ADMIN_ROLES, type JwtPayload } from '../actor';
import { StaffAccessRole } from '../../staff/staff-role';

export const ROLES_KEY = 'polaria:roles';

/**
 * Qué roles pueden entrar a esta ruta.
 *
 * Va siempre **después** de `AuthGuard('jwt')`: este guard decide qué puede hacer
 * quien ya se identificó, no si se identificó.
 */
export const Roles = (...roles: StaffAccessRole[]) =>
  SetMetadata(ROLES_KEY, roles);

/** Atajo para lo que solo toca a quien administra el negocio. */
export const AdminOnly = () => Roles(...ADMIN_ROLES);

/**
 * Deja pasar solo a los roles declarados.
 *
 * Es un permiso y no un filtro: rechaza con 403 en lugar de recortar la respuesta.
 * Para lo que un profesional **sí** puede ver pero acotado a él —su agenda, sus
 * números— el mecanismo es otro: el `staffId` se toma del token y se ignora el que
 * venga por query. Recortar y rechazar son dos cosas distintas y conviene que se
 * vean distintas en el código.
 *
 * Sin metadata en la ruta no bloquea nada: la protección se declara donde hace
 * falta, no se hereda de estar montado.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<StaffAccessRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!allowed?.length) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>();

    const actor = actorFrom(request.user ?? { sub: '' });

    if (!allowed.includes(actor.role)) {
      this.logger.warn(
        `Acceso rechazado por rol (tenantId=${actor.tenantId}, staffId=${actor.staffId ?? 'owner'}, role=${actor.role}, ruta=${request.method} ${request.path}).`,
      );
      throw new ForbiddenException(
        'Tu rol no tiene permiso para esta sección.',
      );
    }

    return true;
  }
}
