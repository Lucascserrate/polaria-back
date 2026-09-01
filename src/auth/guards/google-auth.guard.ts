import { Injectable } from '@nestjs/common';
import { AuthGuard, type IAuthModuleOptions } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  // Sin prompt=select_account, Google reutiliza en silencio la sesión activa
  // del navegador y nunca muestra el selector de cuentas.
  getAuthenticateOptions(): IAuthModuleOptions {
    return { prompt: 'select_account' };
  }
}
