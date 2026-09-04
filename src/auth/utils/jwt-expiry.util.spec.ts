import { isUnexpiredJwt } from './jwt-expiry.util';

const NOW = 1_700_000_000_000;

/** Un JWT de mentira: solo importa el payload, la firma no se mira. */
const tokenWith = (payload: Record<string, unknown>) =>
  `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

/**
 * Lo que decide si la cookie de suplantación se usa o se ignora.
 *
 * La prueba existe por un bug concreto en producción: `fromExtractors` entrega
 * el primer token que encuentra y ahí termina, así que un token de soporte
 * vencido con prioridad hacía fallar **todas** las peticiones sin dar la
 * oportunidad a `accessToken`. Volver a loguearse no arreglaba nada, porque la
 * cookie vieja seguía ganando.
 */
describe('isUnexpiredJwt', () => {
  it('acepta un token que todavía no vence', () => {
    const token = tokenWith({ sub: 't-1', exp: (NOW + 60_000) / 1000 });

    expect(isUnexpiredJwt(token, NOW)).toBe(true);
  });

  it('rechaza uno vencido, para que se pueda caer a la sesión propia', () => {
    const token = tokenWith({ sub: 't-1', exp: (NOW - 1_000) / 1000 });

    expect(isUnexpiredJwt(token, NOW)).toBe(false);
  });

  it('rechaza el borde exacto', () => {
    const token = tokenWith({ sub: 't-1', exp: NOW / 1000 });

    expect(isUnexpiredJwt(token, NOW)).toBe(false);
  });

  /*
   * Sin cookie es el caso normal —nadie está suplantando— y tiene que devolver
   * `false` para que el extractor siga con `accessToken`.
   */
  it('no se cae con cookie ausente ni vacía', () => {
    expect(isUnexpiredJwt(undefined, NOW)).toBe(false);
    expect(isUnexpiredJwt(null, NOW)).toBe(false);
    expect(isUnexpiredJwt('', NOW)).toBe(false);
  });

  /*
   * Basura en la cookie no puede tumbar la autenticación de nadie: cae a la
   * sesión propia, que es el peor caso aceptable.
   */
  it('trata como inservible cualquier cosa que no sea un JWT legible', () => {
    expect(isUnexpiredJwt('no-es-un-jwt', NOW)).toBe(false);
    expect(isUnexpiredJwt('a.b.c', NOW)).toBe(false);
    expect(isUnexpiredJwt('header..sig', NOW)).toBe(false);
  });

  /* Un token sin `exp` no lo emitimos nosotros: el de soporte siempre lo lleva. */
  it('rechaza un token sin exp', () => {
    expect(isUnexpiredJwt(tokenWith({ sub: 't-1' }), NOW)).toBe(false);
  });

  it('rechaza un exp que no es número', () => {
    expect(isUnexpiredJwt(tokenWith({ sub: 't-1', exp: 'pronto' }), NOW)).toBe(
      false,
    );
  });
});
