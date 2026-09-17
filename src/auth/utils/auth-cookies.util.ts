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

/**
 * La cookie de quien se identificó con Google y todavía no tiene negocio.
 *
 * Aparte de `accessToken` por el mismo motivo que la de soporte, pero al revés:
 * no conviene que **gane**, conviene que ni se vea. `JwtStrategy` no la lee, así
 * que un token de alta no puede hacerse pasar por una sesión; lo único que
 * autoriza es la pantalla de alta, a través de `SignupGuard`.
 *
 * No hay `refreshToken` que la acompañe: es un trámite de un rato, no una
 * sesión. Si vence, se vuelve a entrar con Google y nada se perdió, porque
 * todavía no había nada.
 */
export const SIGNUP_COOKIE = 'signupToken';

/**
 * Cuánto dura el trámite de alta.
 *
 * Media hora alcanza para leer dos opciones, buscar el negocio y escribir el
 * nombre; y es poco para que quede dando vueltas en una computadora compartida
 * del local, que es el equipo donde esto va a pasar más de una vez.
 */
export const SIGNUP_TTL_SECONDS = 30 * 60;

export const setSignupCookie = (res: Response, token: string) => {
  res.cookie(SIGNUP_COOKIE, token, {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: SIGNUP_TTL_SECONDS * 1000,
  });
};

export const clearSignupCookie = (res: Response) => {
  res.clearCookie(SIGNUP_COOKIE, AUTH_COOKIE_OPTIONS);
};
