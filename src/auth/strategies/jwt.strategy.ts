import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';

import type { JwtPayload } from '../actor';
import { IMPERSONATION_COOKIE } from '../utils/auth-cookies.util';

const jwtSecret = process.env.SECRET_JWT ?? '';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        /*
         * La sesión de soporte gana sobre la propia mientras exista.
         *
         * Es todo el interruptor de la suplantación: en vez de pisar
         * `accessToken` —que dejaría al super admin sin su sesión y obligaría a
         * volver a entrar con Google al terminar—, se agrega una cookie aparte
         * que tiene prioridad. Salir es borrarla.
         */
        (req: Request) =>
          (req?.cookies?.[IMPERSONATION_COOKIE] as string | undefined) ?? null,
        (req: Request) => {
          return req?.cookies?.accessToken as string | null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  validate(payload: JwtPayload) {
    return payload;
  }
}
