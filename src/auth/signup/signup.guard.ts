import {
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  type CanActivate,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { SIGNUP_COOKIE } from '../utils/auth-cookies.util';
import type { SignupPayload } from '../utils/jwt-token.util';

const jwtSecret = process.env.SECRET_JWT ?? '';

type SignupRequest = Request & { signup?: SignupPayload };

/**
 * Deja pasar solo a quien está en el trámite de alta.
 *
 * Es el único guard que acepta el token de alta, y ningún otro endpoint lo monta:
 * eso es lo que acota lo que ese token puede hacer. `AuthGuard('jwt')` tampoco lo
 * ve, porque viaja en su propia cookie y porque `JwtStrategy.validate` rechaza
 * cualquier payload con `kind`.
 *
 * Se verifica `kind` acá también, y no es redundante: un `accessToken` legítimo
 * está firmado con el mismo secreto, así que sin esta comprobación una sesión
 * normal copiada a esta cookie pasaría por un alta —con `googleId` vacío— y
 * crearía un negocio a nombre de nadie.
 */
@Injectable()
export class SignupGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SignupRequest>();
    const token = request.cookies?.[SIGNUP_COOKIE] as string | undefined;

    if (!token) throw new UnauthorizedException();

    let payload: SignupPayload;
    try {
      payload = this.jwtService.verify<SignupPayload>(token, {
        secret: jwtSecret,
      });
    } catch {
      throw new UnauthorizedException();
    }

    if (payload?.kind !== 'signup' || !payload.googleId) {
      throw new UnauthorizedException();
    }

    request.signup = payload;
    return true;
  }
}

/** Quién está dándose de alta, ya verificado por `SignupGuard`. */
export const Signup = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SignupPayload => {
    const request = context.switchToHttp().getRequest<SignupRequest>();

    // No debería faltar: el guard corre antes y rechaza sin él.
    if (!request.signup) throw new UnauthorizedException();

    return request.signup;
  },
);
