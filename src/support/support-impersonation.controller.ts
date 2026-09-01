import {
  Controller,
  ForbiddenException,
  Logger,
  NotFoundException,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Actor, type AuthenticatedActor } from '../auth/actor';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import {
  clearImpersonationCookie,
  setImpersonationCookie,
} from '../auth/utils/auth-cookies.util';
import { createImpersonationToken } from '../auth/utils/jwt-token.util';
import { TenantsService } from '../tenants/tenants.service';

/**
 * Entrar a un negocio como soporte, y salir.
 *
 * Reemplaza a lo que se hacía a mano —desloguearse y volver a entrar con la
 * cuenta del negocio—, que tenía dos problemas: dejaba al super admin sin su
 * propia sesión, y producía un token idéntico al de un login real. Lo segundo es
 * lo grave: después nadie podía distinguir en los registros lo que hizo soporte
 * de lo que hizo el dueño.
 *
 * Acá la sesión de soporte va en una cookie aparte que tiene prioridad, dura una
 * hora y viaja marcada. Ver `createImpersonationToken` y `JwtStrategy`.
 */
@ApiTags('support')
@ApiBearerAuth()
@Controller('support')
export class SupportImpersonationController {
  private readonly logger = new Logger(SupportImpersonationController.name);

  constructor(
    private readonly tenantsService: TenantsService,
    private readonly jwtService: JwtService,
  ) {}

  @UseGuards(AuthGuard('jwt'), SuperAdminGuard)
  @Post('tenants/:tenantId/impersonate')
  @ApiOperation({
    summary:
      'Abre una sesión de soporte sobre un negocio. La sesión propia del super admin queda intacta.',
  })
  async impersonate(
    @Param('tenantId') tenantId: string,
    @Actor() actor: AuthenticatedActor,
    @Res({ passthrough: true }) res: Response,
  ) {
    /*
     * Suplantar desde una sesión suplantada no se permite.
     *
     * El guard de super admin ya lo impide de hecho —el token de soporte lleva
     * el correo del negocio, no el del admin—, pero decirlo acá deja explícito
     * que es una regla y no una casualidad de cómo se arma el token.
     */
    if (actor.impersonatedBy) {
      throw new ForbiddenException(
        'Ya estás en una sesión de soporte. Salí antes de entrar a otro negocio.',
      );
    }

    const tenant = await this.tenantsService.findOne(tenantId);
    if (!tenant) throw new NotFoundException('Tenant not found');

    const email = actor.email ?? 'desconocido';
    setImpersonationCookie(
      res,
      createImpersonationToken(tenant, email, this.jwtService),
    );

    // El registro es la mitad del punto de todo esto: sin esta línea, entrar al
    // negocio de otro no deja rastro en ningún lado.
    this.logger.warn(
      `Sesión de soporte abierta (by=${email}, tenantId=${tenant.id}, negocio=${tenant.name}).`,
    );

    return { tenantId: tenant.id, businessName: tenant.name };
  }

  /**
   * Sin guards a propósito.
   *
   * `AuthGuard('jwt')` leería la cookie de soporte —que es la que tiene
   * prioridad— y `SuperAdminGuard` la rechazaría, porque lleva el correo del
   * negocio: salir sería imposible con los mismos guards que entrar. Y con la
   * sesión vencida tampoco habría token que validar, que es justo cuando más
   * hace falta poder salir. Borrar una cookie del propio navegador no necesita
   * permiso; es lo mismo que hace `/auth/logout`.
   */
  @Post('impersonate/exit')
  exit(@Res({ passthrough: true }) res: Response) {
    clearImpersonationCookie(res);
    return { ok: true };
  }
}
