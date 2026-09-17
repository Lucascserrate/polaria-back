import { Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { TenantsService } from '../../tenants/tenants.service';
import { clearSignupCookie, setAuthCookies } from '../utils/auth-cookies.util';
import { createJwtToken, type SignupPayload } from '../utils/jwt-token.util';
import { Signup, SignupGuard } from './signup.guard';

/**
 * El alta: qué hace en Polaria una cuenta de Google que todavía no es nada.
 *
 * Existe por un incidente. El login creaba el negocio cuando no encontraba
 * ninguno, así que un empleado cuya invitación no estaba cargada entraba y se
 * iba con una peluquería vacía a su nombre —y su correo quedaba tomado, con lo
 * cual el dueño ya no podía invitarlo—. Crear un negocio dejó de ser el efecto
 * secundario de autenticarse y pasó a ser algo que alguien elige.
 *
 * Todo acá va detrás de `SignupGuard` y de nada más: estos son los únicos
 * endpoints que acepta el token de alta.
 */
@ApiTags('auth')
@UseGuards(SignupGuard)
@Controller('signup')
export class SignupController {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Quién se está dando de alta.
   *
   * La pantalla lo necesita para dos cosas: saludar por el nombre, y —sobre
   * todo— mostrar el correo. Quien va a pedir acceso tiene que poder leer con
   * qué cuenta entró, porque es el dato exacto que su jefe necesita cargar.
   */
  @Get('session')
  session(@Signup() signup: SignupPayload) {
    return { email: signup.email, name: signup.name };
  }

  /**
   * Crear el negocio: lo que antes pasaba solo.
   *
   * Al terminar se cambia la cookie de alta por las de sesión, así que la
   * siguiente petición ya es la de un dueño y la pantalla sigue a la
   * configuración inicial como siempre.
   */
  @Post('business')
  async createBusiness(
    @Signup() signup: SignupPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    /*
     * El nombre y la zona por defecto los pone `createForGoogleAccount`, que es
     * el mismo camino que usaba el login: repetirlos acá sería una segunda
     * versión de los valores con los que nace un negocio.
     */
    const tenant = await this.tenantsService.createForGoogleAccount({
      googleId: signup.googleId,
      email: signup.email ?? undefined,
      displayName: signup.name ?? undefined,
    });

    setAuthCookies(res, createJwtToken(tenant, this.jwtService));
    clearSignupCookie(res);

    return { tenantId: tenant.id };
  }
}
