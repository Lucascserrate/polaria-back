import type { CookieOptions, Response } from 'express';

export const AUTH_COOKIE_OPTIONS: CookieOptions = {
  secure: true,
  sameSite: 'none',
  path: '/',
};

export const setAuthCookies = (
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
) => {
  res.cookie('accessToken', tokens.accessToken, AUTH_COOKIE_OPTIONS);
  res.cookie('refreshToken', tokens.refreshToken, AUTH_COOKIE_OPTIONS);
};

/**
 * La cookie de la sesión de soporte.
 *
 * Aparte de `accessToken` y no en su lugar: así la sesión propia del super admin
 * queda intacta mientras mira otro negocio, y salir es borrar **esta** cookie,
 * sin pasar de nuevo por Google. Pisar `accessToken` habría obligado a volver a
 * loguearse cada vez que se termina de atender a alguien.
 */
export const IMPERSONATION_COOKIE = 'impersonationToken';

/**
 * Cuánto dura una sesión de soporte. La comparten el token y la cookie.
 *
 * Que la cookie caduque sola es la segunda red: sin `maxAge` era una cookie de
 * sesión, y los navegadores que restauran pestañas al abrir —Chrome con
 * "continuar donde lo dejaste"— la traían de vuelta días después.
 */
export const IMPERSONATION_TTL_SECONDS = 60 * 60;

export const setImpersonationCookie = (res: Response, token: string) => {
  res.cookie(IMPERSONATION_COOKIE, token, {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: IMPERSONATION_TTL_SECONDS * 1000,
  });
};

export const clearImpersonationCookie = (res: Response) => {
  res.clearCookie(IMPERSONATION_COOKIE, AUTH_COOKIE_OPTIONS);
};
