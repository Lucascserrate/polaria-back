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
