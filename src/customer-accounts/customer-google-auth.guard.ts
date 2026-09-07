import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard, type IAuthModuleOptions } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { AUTH_COOKIE_OPTIONS } from '../auth/utils/auth-cookies.util';
import { CUSTOMER_GOOGLE_STRATEGY } from './customer-google.strategy';
import { DEFAULT_PUBLIC_SITE_BASE_URL } from '../tenants/public-booking-url';

/**
 * A dónde volver después de iniciar sesión, mientras el navegador está en
 * Google.
 *
 * Se guarda en una cookie corta y no en el `state` de OAuth por una razón
 * práctica: el `state` de passport hay que serializarlo y validarlo a mano, y
 * cualquier error ahí se paga con un redirect abierto. La cookie la escribe y la
 * lee el mismo servidor, y de todas formas el destino se valida contra el
 * dominio propio.
 */
export const CUSTOMER_RETURN_TO_COOKIE = 'customerReturnTo';

/** Cinco minutos: lo que tarda alguien en elegir su cuenta de Google. */
const RETURN_TO_TTL_SECONDS = 5 * 60;

const publicSiteBaseUrl = (): string =>
  (process.env.PUBLIC_SITE_BASE_URL || DEFAULT_PUBLIC_SITE_BASE_URL).replace(
    /\/+$/,
    '',
  );

/**
 * Un destino permitido, o la raíz del sitio público.
 *
 * Es la defensa contra el redirect abierto: sin esto, `?returnTo=` en un enlace
 * que dice "iniciá sesión en Polaria" mandaría a la víctima a cualquier sitio
 * **después** de un login legítimo, que es exactamente la forma que tiene una
 * página falsa de parecer nuestra. Solo se aceptan direcciones del propio sitio
 * y rutas relativas.
 */
export const safeReturnTo = (raw: string | undefined): string => {
  const base = publicSiteBaseUrl();
  if (!raw) return base;

  // Una ruta relativa (`/royal-barber`) es del sitio por definición. Se
  // rechazan las que empiezan con `//`, que el navegador lee como otro dominio.
  if (raw.startsWith('/') && !raw.startsWith('//')) return `${base}${raw}`;

  try {
    const target = new URL(raw);
    return target.origin === new URL(base).origin ? target.toString() : base;
  } catch {
    return base;
  }
};

@Injectable()
export class CustomerGoogleAuthGuard extends AuthGuard(
  CUSTOMER_GOOGLE_STRATEGY,
) {
  canActivate(context: ExecutionContext) {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    response.cookie(
      CUSTOMER_RETURN_TO_COOKIE,
      safeReturnTo(
        (request.query as Record<string, string | undefined>).returnTo,
      ),
      {
        ...AUTH_COOKIE_OPTIONS,
        httpOnly: true,
        maxAge: RETURN_TO_TTL_SECONDS * 1000,
        domain: process.env.COOKIE_DOMAIN?.trim() || undefined,
      },
    );

    return super.canActivate(context);
  }

  // Sin `prompt=select_account`, Google reutiliza en silencio la sesión activa
  // del navegador. Acá importa más que en el panel: en un teléfono compartido,
  // la primera cuenta que quedó abierta reservaría por todos los demás.
  getAuthenticateOptions(): IAuthModuleOptions {
    return { prompt: 'select_account' };
  }
}
