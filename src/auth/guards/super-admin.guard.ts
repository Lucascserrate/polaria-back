import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Acceso a las herramientas internas de soporte.
 *
 * Hace falta un permiso propio porque el JWT identifica a un **negocio**, no a
 * un rol: con solo `AuthGuard('jwt')`, cualquier negocio registrado podría
 * listar y crear tenants. Eso era tolerable mientras entrar requería estar en la
 * whitelist; con registro abierto, alcanzaría con crearse una cuenta.
 *
 * La lista va por variable de entorno y no por columna a propósito: es una
 * decisión de operación, se cambia sin desplegar y no agrega un rol al modelo de
 * datos que después habría que mantener. Cuando estas pantallas se muden a su
 * propio repositorio, esto se va con ellas.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  private readonly logger = new Logger(SuperAdminGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<
        Request & { user?: { sub?: string; email?: string | null } }
      >();

    const allowed = this.allowedEmails();

    // Sin lista configurada no pasa nadie. Un permiso administrativo que se
    // abre por olvidar una variable de entorno no es un permiso.
    if (allowed.length === 0) {
      this.logger.error(
        'SUPER_ADMIN_EMAILS no está configurado: se rechaza el acceso a soporte.',
      );
      throw new ForbiddenException();
    }

    const email = request.user?.email?.trim().toLowerCase();
    if (!email || !allowed.includes(email)) {
      this.logger.warn(
        `Acceso a soporte rechazado (tenantId=${String(request.user?.sub)}).`,
      );
      throw new ForbiddenException();
    }

    return true;
  }

  private allowedEmails(): string[] {
    return (this.configService.get<string>('SUPER_ADMIN_EMAILS') ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
  }
}
