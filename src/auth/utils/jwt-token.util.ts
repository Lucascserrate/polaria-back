import { JwtService } from '@nestjs/jwt';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Staff } from '../../staff/entities/staff.entity';
import { StaffAccessRole } from '../../staff/staff-role';
import type { JwtPayload } from '../actor';

const jwtSecret = process.env.SECRET_JWT ?? '';

/**
 * El token del dueño.
 *
 * `sub` sigue siendo el `tenantId` y no va a dejar de serlo: es lo que leen unos
 * veinte controladores, y cambiarlo por un id de persona habría convertido este
 * cambio en una migración de todo el backend. El token creció con `actorId` y
 * `role` en lugar de cambiar de forma, así que los que ya están emitidos —treinta
 * días de validez— siguen valiendo y se leen como lo que son: sesiones de dueño.
 */
export const createJwtToken = (tenant: Tenant, jwtService: JwtService) =>
  signPayload(
    {
      sub: tenant.id,
      email: tenant.email ?? null,
      actorId: null,
      role: StaffAccessRole.OWNER,
    },
    jwtService,
  );

/**
 * El token de un miembro del equipo.
 *
 * El `sub` es el negocio al que pertenece, igual que en el del dueño: todo lo que
 * ya filtra por tenant sigue filtrando bien sin enterarse de que ahora hay
 * personas. Lo que acota la sesión a esta persona es `actorId`, que es de donde
 * sale el `staffId` cuando hay que recortar una respuesta a lo suyo.
 */
export const createStaffJwtToken = (staff: Staff, jwtService: JwtService) =>
  signPayload(
    {
      sub: staff.tenantId,
      email: staff.accessEmail ?? null,
      actorId: staff.id,
      role: staff.accessRole,
    },
    jwtService,
  );

const signPayload = (payload: JwtPayload, jwtService: JwtService) => ({
  accessToken: jwtService.sign(payload),
  refreshToken: jwtService.sign(payload, {
    expiresIn: '7d',
    secret: jwtSecret,
  }),
});

/**
 * Duración de una sesión de soporte.
 *
 * Una hora y no los treinta días de un login normal: se entra a un negocio
 * ajeno para resolver algo puntual, no para quedarse. Si vence a mitad de
 * camino se vuelve a pedir desde el panel, que es un click.
 */
export const IMPERSONATION_TTL = '1h';

/**
 * El token con el que soporte mira un negocio desde adentro.
 *
 * Para todo el backend es una sesión de dueño —mismo `sub`, mismo `role`—
 * porque el objetivo es ver exactamente lo que ve el negocio: un rol especial
 * daría una vista que nadie más tiene, y entonces no serviría para reproducir el
 * problema que el dueño está reportando.
 *
 * Lo que sí lo distingue son `imp` y `act`, y esa es toda la diferencia: sin
 * ellos el token sería indistinguible del que se emite en un login real, y
 * ningún log podría decir después quién estuvo adentro.
 *
 * No se emite `refreshToken` a propósito: renovarse sola convertiría una sesión
 * de una hora en una permanente.
 */
export const createImpersonationToken = (
  tenant: Tenant,
  superAdminEmail: string,
  jwtService: JwtService,
): string =>
  jwtService.sign(
    {
      sub: tenant.id,
      email: tenant.email ?? null,
      actorId: null,
      role: StaffAccessRole.OWNER,
      imp: true,
      act: superAdminEmail,
    },
    { expiresIn: IMPERSONATION_TTL, secret: jwtSecret },
  );
