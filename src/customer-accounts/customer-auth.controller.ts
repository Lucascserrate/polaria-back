import {
  Body,
  Controller,
  Get,
  Logger,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AUTH_COOKIE_OPTIONS } from '../auth/utils/auth-cookies.util';
import { dialCodeForTimeZone } from '../tenants/dial-code';
import { CustomerAccountsService } from './customer-accounts.service';
import {
  CUSTOMER_GOOGLE_STRATEGY,
  type CustomerGoogleProfile,
} from './customer-google.strategy';
import {
  CUSTOMER_RETURN_TO_COOKIE,
  CustomerGoogleAuthGuard,
  safeReturnTo,
} from './customer-google-auth.guard';
import {
  CustomerAccountId,
  CustomerGuard,
  CustomerSessionService,
} from './customer-session';
import { SetCustomerPhoneDto } from './dto/set-customer-phone.dto';

type CustomerCallbackRequest = Request & { user?: CustomerGoogleProfile };

/**
 * La sesión de quien reserva.
 *
 * Cuelga de `/customer` y no de `/auth` a propósito: son dos sistemas de
 * identidad que no se cruzan, y tenerlos en rutas separadas hace evidente cuál
 * es cuál al leer un log o una configuración de CORS. Ver `customer-session.ts`.
 */
@ApiTags('customer')
@Controller('customer')
export class CustomerAuthController {
  private readonly logger = new Logger(CustomerAuthController.name);

  constructor(
    private readonly accounts: CustomerAccountsService,
    private readonly session: CustomerSessionService,
  ) {}

  /** Manda a Google. El `?returnTo=` vuelve a la página donde estaba reservando. */
  @Get('auth/google')
  @UseGuards(CustomerGoogleAuthGuard)
  startGoogleLogin() {
    // Passport redirige; este cuerpo no se ejecuta nunca.
  }

  /**
   * La vuelta de Google: crea o encuentra la cuenta, abre la sesión y devuelve
   * al cliente a donde estaba.
   *
   * Redirige en lugar de responder JSON porque acá el navegador está navegando,
   * no llamando a una API: viene de un formulario de Google y tiene que terminar
   * en la página del negocio.
   */
  @Get('auth/google/callback')
  @UseGuards(AuthGuard(CUSTOMER_GOOGLE_STRATEGY))
  async googleCallback(
    @Req() req: CustomerCallbackRequest,
    @Res() res: Response,
  ) {
    const profile = req.user;
    const returnTo = safeReturnTo(
      (req.cookies as Record<string, string> | undefined)?.[
        CUSTOMER_RETURN_TO_COOKIE
      ],
    );

    res.clearCookie(CUSTOMER_RETURN_TO_COOKIE, {
      ...AUTH_COOKIE_OPTIONS,
      domain: process.env.COOKIE_DOMAIN?.trim() || undefined,
    });

    if (!profile) {
      this.logger.warn('Callback de Google sin perfil: no se abre sesión.');
      return res.redirect(returnTo);
    }

    const account = await this.accounts.findOrCreateByGoogle(profile);
    this.session.setCookie(res, account.id);

    return res.redirect(returnTo);
  }

  /**
   * Quién está en sesión, o `null`.
   *
   * `null` con 200 y no un 401: el sitio pregunta esto en cada carga de una
   * página de reservas para decidir si muestra el botón de Google o el resumen,
   * y no haber iniciado sesión es la respuesta normal, no un error.
   */
  @Get('me')
  async me(@Req() req: Request) {
    const accountId = this.session.read(req);
    if (!accountId) return null;

    return (await this.accounts.viewOf(accountId)) ?? null;
  }

  /**
   * Guarda el teléfono que falta para poder reservar.
   *
   * Es lo único que Google no puede darnos, y por eso se pide una sola vez: de
   * acá en adelante la persona reserva en cualquier negocio de Polaria sin
   * volver a escribirlo.
   *
   * `timezone` llega desde la página del negocio y sirve para deducir el prefijo
   * cuando el número se escribe local. Es el mismo criterio del formulario
   * público: quien escribe con `+` manda su propio país.
   */
  @Patch('me/phone')
  @UseGuards(CustomerGuard)
  setPhone(
    @CustomerAccountId() accountId: string,
    @Body() body: SetCustomerPhoneDto,
  ) {
    return this.accounts.setPhone(
      accountId,
      body.phone,
      dialCodeForTimeZone(body.timezone),
    );
  }

  @Post('auth/logout')
  logout(@Res() res: Response) {
    this.session.clearCookie(res);
    return res.status(200).json({ ok: true });
  }
}
