import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import { TenantsService } from '../tenants/tenants.service';
import { Tenant } from '../tenants/entities/tenant.entity';
import { GoogleUserDto } from './dto/google-user.dto';
import { createJwtToken } from './utils/jwt-token.util';
import { AUTH_COOKIE_OPTIONS, setAuthCookies } from './utils/auth-cookies.util';
import { AuthError } from './domain/enums/auth.enum';
import { TenantError } from '../tenants/enums/tenant.enum';

const { CLIENT_BASE_URL } = process.env;
const jwtSecret = process.env.SECRET_JWT ?? '';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly tenantsService: TenantsService,
    private readonly jwtService: JwtService,
  ) {}

  async oauthLogin(user: GoogleUserDto) {
    try {
      if (!user?.googleId) {
        throw new HttpException(
          AuthError.UNAUTHORIZED,
          HttpStatus.UNAUTHORIZED,
        );
      }

      /*
       * Acá estaba la whitelist: si la cuenta no existía como tenant, se
       * rechazaba el login. Ahora el primer acceso crea el negocio, y la
       * búsqueda por correo sigue vinculando a los que dio de alta soporte.
       */
      const tenant = await this.tenantsService.findOrCreateByGoogleAccount({
        googleId: user.googleId,
        email: user.email,
        displayName: user.displayName,
      });

      return this.createSession(tenant);
    } catch {
      throw new HttpException(
        AuthError.LOGIN_FAILED,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private createSession(tenant: Tenant) {
    return {
      statusCode: HttpStatus.OK,
      data: {
        user: tenant,
        tokens: createJwtToken(tenant, this.jwtService),
      },
    };
  }

  async OAuthCallback(user: GoogleUserDto, res: Response) {
    try {
      const { data } = await this.oauthLogin(user);
      this.logger.log(
        `OAuthCallback user=${user.email ?? 'unknown'} googleId=${user.googleId ?? 'missing'} tokensReady=${Boolean(data?.tokens?.accessToken && data?.tokens?.refreshToken)}`,
      );

      this.logger.log(
        `Setting auth cookies secure=${AUTH_COOKIE_OPTIONS.secure} sameSite=${AUTH_COOKIE_OPTIONS.sameSite} path=${AUTH_COOKIE_OPTIONS.path} domain=${AUTH_COOKIE_OPTIONS.domain ?? 'host-only'}`,
      );

      setAuthCookies(res, data.tokens);

      this.logger.log(
        `Set-Cookie header=${JSON.stringify(res.getHeader('Set-Cookie'))}`,
      );

      this.logger.log(
        `Auth cookies set. redirectingTo=${CLIENT_BASE_URL ?? 'undefined'}`,
      );

      res.redirect(`${CLIENT_BASE_URL}`);
    } catch (error) {
      this.logger.error(
        `OAuthCallback failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
      res.redirect(`${CLIENT_BASE_URL}/not-found`);
    }
  }

  async refreshToken(token?: string) {
    if (!token) {
      throw new HttpException(AuthError.MISSING_TOKEN, HttpStatus.UNAUTHORIZED);
    }
    try {
      const payload = this.jwtService.verify<{ sub: string }>(token, {
        secret: jwtSecret,
      });
      const tenant = await this.tenantsService.findOne(payload.sub);

      if (!tenant) {
        throw new HttpException(TenantError.NOT_FOUND, HttpStatus.UNAUTHORIZED);
      }

      const tokens = createJwtToken(tenant, this.jwtService);
      return {
        statusCode: HttpStatus.OK,
        data: {
          tenant,
          tokens,
        },
      };
    } catch {
      throw new HttpException(AuthError.INVALID_TOKEN, HttpStatus.UNAUTHORIZED);
    }
  }

  /**
   * Quién entró: el nombre del negocio y la cuenta de Google.
   *
   * Existe aparte de `validateTenant`, que devuelve el tenant entero —token de
   * WhatsApp incluido—. Para saludar en el menú alcanzan dos campos, y son los
   * únicos que se van a pedir en cada pantalla del panel.
   */
  async getAccount(tenantId: string) {
    const tenant = await this.tenantsService.findOne(tenantId);
    if (!tenant) {
      throw new HttpException(
        TenantError.NOT_AUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
      );
    }

    return { name: tenant.name, email: tenant.email ?? null };
  }

  async validateTenant(payload: { sub: string }) {
    const tenant = await this.tenantsService.findOne(payload.sub);
    if (!tenant) {
      throw new HttpException(
        TenantError.NOT_AUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
      );
    }

    return this.authenticatedResponse(tenant);
  }

  private authenticatedResponse(tenant: Tenant) {
    return {
      statusCode: HttpStatus.OK,
      message: 'Tenant is authenticated',
      user: tenant,
    };
  }
}
