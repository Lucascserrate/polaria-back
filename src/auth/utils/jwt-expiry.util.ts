/**
 * Si un token todavía sirve, mirando solo su `exp`.
 *
 * **No valida la firma**, y no hace falta: esto no decide si se confía en un
 * token sino *cuál de dos* se le entrega a Passport, que después lo verifica en
 * serio. Un token forjado que pase por acá se rechaza igual un paso más
 * adelante; lo único que se puede conseguir mintiendo en el `exp` es que la
 * propia sesión se descarte, que es menos acceso y no más.
 *
 * Sin `exp` devuelve `false` a propósito: el único token que pasa por acá es el
 * de suplantación, que siempre lo lleva. Uno sin `exp` es un token que no
 * emitimos nosotros.
 */
export const isUnexpiredJwt = (
  token: string | null | undefined,
  now: number = Date.now(),
): token is string => {
  if (!token) return false;

  const expiresAt = readExpiry(token);
  return expiresAt !== null && expiresAt > now;
};

/** El `exp` en milisegundos, o `null` si el token no es legible. */
const readExpiry = (token: string): number | null => {
  const [, payload] = token.split('.');
  if (!payload) return null;

  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    );

    if (typeof decoded !== 'object' || decoded === null) return null;

    const exp = (decoded as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
};
