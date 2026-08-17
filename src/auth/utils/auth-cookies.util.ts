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
