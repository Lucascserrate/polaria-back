import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { StaffAccessRole } from '../staff/staff-role';

/**
 * Quién está haciendo la petición.
 *
 * Hasta ahora la respuesta era una sola —el negocio— porque el `sub` del JWT *es*
 * el `tenantId`, y eso lo leen unos veinte controladores. Sigue siendo así: el
 * token creció con dos campos en lugar de cambiar de forma, así que ningún
 * controlador existente dejó de funcionar y los tokens ya emitidos siguen valiendo.
 *
 * `staffId` en `null` significa que entró el dueño, que no es una fila de `staff`
 * sino el tenant mismo. Es la asimetría que queda de que la cuenta del negocio y
 * la persona que lo creó sean la misma cosa; el día que el dueño también tenga su
 * ficha en el equipo, esto pasa a ser siempre un id.
 */
export interface AuthenticatedActor {
  tenantId: string;
  /** `null` para el dueño. */
  staffId: string | null;
  role: StaffAccessRole;
  email: string | null;
}

/** El payload tal como lo firma `createJwtToken`. */
export interface JwtPayload {
  sub: string;
  email?: string | null;
  actorId?: string | null;
  role?: string | null;
}

/**
 * Normaliza el payload a un actor.
 *
 * Un token **sin** `role` se lee como dueño, y no es una suposición cómoda: hasta
 * que existió el acceso del equipo, el único login posible era el del negocio. Los
 * tokens emitidos antes de este cambio son todos de dueños, y duran treinta días.
 * Tratarlos como un rol menor los habría dejado sin panel hasta que vencieran.
 *
 * Un `role` que no reconocemos no cae a dueño: cae a profesional, que es el rol
 * con menos permisos. Ante un token raro conviene dar de menos, no de más.
 */
export const actorFrom = (payload: JwtPayload): AuthenticatedActor => {
  const staffId = payload.actorId ?? null;

  return {
    tenantId: payload.sub,
    staffId,
    role: resolveRole(payload.role, staffId),
    email: payload.email ?? null,
  };
};

const resolveRole = (
  role: string | null | undefined,
  staffId: string | null,
): StaffAccessRole => {
  if (!role)
    return staffId ? StaffAccessRole.PROFESSIONAL : StaffAccessRole.OWNER;

  return isKnownRole(role) ? role : StaffAccessRole.PROFESSIONAL;
};

const isKnownRole = (role: string): role is StaffAccessRole =>
  Object.values(StaffAccessRole).includes(role as StaffAccessRole);

/**
 * Los roles que pueden administrar el negocio.
 *
 * El dueño y el administrador, y la diferencia entre los dos no es de permisos
 * sino de origen: el dueño no se asigna, se es. Para todo lo demás son lo mismo,
 * así que las rutas se protegen con esta lista y no enumerando roles cada vez.
 */
export const ADMIN_ROLES: readonly StaffAccessRole[] = [
  StaffAccessRole.OWNER,
  StaffAccessRole.ADMIN,
];

export const canAdminister = (actor: AuthenticatedActor): boolean =>
  ADMIN_ROLES.includes(actor.role);

/**
 * El actor de la petición, ya normalizado.
 *
 * Reemplaza al `(req.user as { sub?: string }).sub` repetido en cada controlador,
 * que además de ruidoso obligaba a comprobar a mano que el id estuviera: acá el
 * tipo lo garantiza porque sin `sub` el guard de JWT no habría dejado pasar.
 */
export const Actor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedActor => {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>();

    return actorFrom(request.user ?? { sub: '' });
  },
);
