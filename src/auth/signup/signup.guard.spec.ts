import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';

import { StaffAccessRole } from '../../staff/staff-role';
import { SIGNUP_COOKIE } from '../utils/auth-cookies.util';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { SignupGuard } from './signup.guard';

const secret = process.env.SECRET_JWT ?? '';
const jwtService = new JwtService({ secret });

/** Un contexto de Nest con las cookies que interesan y nada más. */
const contextWith = (cookies: Record<string, string>) => {
  const request = { cookies } as unknown as Record<string, unknown>;

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    request,
  };
};

const activate = (cookies: Record<string, string>) => {
  const context = contextWith(cookies);
  const allowed = new SignupGuard(jwtService).canActivate(
    context as unknown as ExecutionContext,
  );

  return { allowed, request: context.request };
};

/** Lo que emite `createSignupToken`, firmado igual. */
const signupToken = () =>
  jwtService.sign(
    { kind: 'signup', googleId: 'g-1', email: 'juan@gmail.com', name: 'Juan' },
    { secret, expiresIn: '30m' },
  );

/** Un `accessToken` legítimo de dueño: mismo secreto, otro significado. */
const sessionToken = () =>
  jwtService.sign(
    {
      sub: 'tenant-1',
      email: 'dueño@gmail.com',
      actorId: null,
      role: StaffAccessRole.OWNER,
    },
    { secret },
  );

describe('SignupGuard', () => {
  it('deja pasar el token de alta y expone quién es', () => {
    const { allowed, request } = activate({ [SIGNUP_COOKIE]: signupToken() });

    expect(allowed).toBe(true);
    expect(request.signup).toMatchObject({
      googleId: 'g-1',
      email: 'juan@gmail.com',
    });
  });

  it('sin cookie no pasa', () => {
    expect(() => activate({})).toThrow(UnauthorizedException);
  });

  it('con un token que no firmamos nosotros, no pasa', () => {
    expect(() => activate({ [SIGNUP_COOKIE]: 'no.es.un.token' })).toThrow(
      UnauthorizedException,
    );
  });

  it('vencido no pasa', () => {
    const expired = jwtService.sign(
      { kind: 'signup', googleId: 'g-1', email: null, name: null },
      { secret, expiresIn: '-1s' },
    );

    expect(() => activate({ [SIGNUP_COOKIE]: expired })).toThrow(
      UnauthorizedException,
    );
  });

  /*
   * La comprobación que justifica que el guard mire `kind`.
   *
   * Los dos tokens se firman con el mismo secreto, así que la firma de una
   * sesión de dueño es válida acá. Sin este rechazo, copiar el `accessToken` a
   * esta cookie pasaba por un alta con `googleId` vacío y creaba un negocio a
   * nombre de nadie.
   */
  it('una sesión de dueño copiada a esta cookie no pasa', () => {
    expect(() => activate({ [SIGNUP_COOKIE]: sessionToken() })).toThrow(
      UnauthorizedException,
    );
  });
});

describe('JwtStrategy.validate', () => {
  const validate = (payload: unknown) =>
    new JwtStrategy().validate(payload as never);

  it('acepta una sesión de verdad', () => {
    expect(
      validate({
        sub: 'tenant-1',
        email: null,
        actorId: null,
        role: StaffAccessRole.OWNER,
      }),
    ).toMatchObject({ sub: 'tenant-1' });
  });

  /*
   * Sin `sub` no hay negocio, y de `sub` sale el `tenantId` con el que filtra
   * medio backend: antes ese payload llegaba a los controladores y las consultas
   * salían con `tenantId: undefined`, que no es un error sino otra consulta.
   */
  it('rechaza un payload sin negocio', () => {
    expect(() => validate({ email: null })).toThrow(UnauthorizedException);
  });

  /* El token de alta, por si alguien lo copia a `accessToken`. */
  it('rechaza el token de alta', () => {
    expect(() => validate({ kind: 'signup', googleId: 'g-1' })).toThrow(
      UnauthorizedException,
    );
  });
});
