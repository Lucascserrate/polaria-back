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

export const setImpersonationCookie = (res: Response, token: string) => {
  res.cookie(IMPERSONATION_COOKIE, token, AUTH_COOKIE_OPTIONS);
};

export const clearImpersonationCookie = (res: Response) => {
  res.clearCookie(IMPERSONATION_COOKIE, AUTH_COOKIE_OPTIONS);
};
