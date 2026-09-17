import { JwtService } from '@nestjs/jwt';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Staff } from '../../staff/entities/staff.entity';
import { StaffAccessRole } from '../../staff/staff-role';
import type { JwtPayload } from '../actor';
import {
  IMPERSONATION_TTL_SECONDS,
  SIGNUP_TTL_SECONDS,
} from './auth-cookies.util';

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
    { expiresIn: IMPERSONATION_TTL_SECONDS, secret: jwtSecret },
  );

/**
 * Lo que lleva el token de alta: quién es, y nada más.
 *
 * No tiene `sub`, y eso no es una omisión: `sub` significa "el negocio de esta
 * sesión", y el punto de este token es que todavía no hay ninguno. `kind` lo
 * marca de forma explícita para que nada lo confunda con una sesión ni por
 * accidente ni a mano.
 */
export interface SignupPayload {
  kind: 'signup';
  googleId: string;
  email: string | null;
  name: string | null;
}

/**
 * El token del trámite de alta.
 *
 * Corto y sin refresco: autoriza elegir entre crear un negocio o pedir unirse a
 * uno, y se descarta en cuanto eso pasa. Ver `SIGNUP_COOKIE`.
 */
export const createSignupToken = (
  identity: { googleId: string; email?: string; displayName?: string },
  jwtService: JwtService,
): string =>
  jwtService.sign(
    {
      kind: 'signup',
      googleId: identity.googleId,
      email: identity.email ?? null,
      name: identity.displayName?.trim() || null,
    } satisfies SignupPayload,
    { expiresIn: SIGNUP_TTL_SECONDS, secret: jwtSecret },
  );
