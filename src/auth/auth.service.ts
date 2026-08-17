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

      let tenant = await this.tenantsService.findByGoogleId(user.googleId);

      if (!tenant && user.email) {
        const byEmail = await this.tenantsService.findByEmail(user.email);
        if (byEmail && !byEmail.googleId) {
          tenant = await this.tenantsService.setGoogleId(
            byEmail.id,
            user.googleId,
          );
        } else {
          tenant = byEmail;
        }
      }

      if (!tenant) {
        return {
          statusCode: HttpStatus.UNAUTHORIZED,
          data: {
            user: null,
            tokens: null,
          },
          notFound: true as const,
        };
      }

      return this.createSession(tenant);
    } catch {
      throw new HttpException(
        AuthError.LOGIN_FAILED,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Login temporal por correo para la revisión de Meta (App Review).
   *
   * Comparte la misma whitelist que OAuth (existir como tenant) y el mismo
   * mecanismo de sesión (`createSession` + cookies). La única diferencia es
   * el origen del correo: llega en el body en vez de venir del proveedor.
   *
   * TODO: eliminar junto con `POST /auth/local-login` al terminar la revisión.
   */
  async localLogin(email: string, res: Response) {
    const tenant = await this.tenantsService.findByEmail(email);

    if (!tenant) {
      this.logger.warn(`localLogin rejected, email not whitelisted: ${email}`);
      throw new HttpException(AuthError.UNAUTHORIZED, HttpStatus.UNAUTHORIZED);
    }

    const { data } = this.createSession(tenant);
    setAuthCookies(res, data.tokens);

    this.logger.log(`localLogin succeeded tenantId=${tenant.id}`);

    return this.authenticatedResponse(tenant);
  }

  private createSession(tenant: Tenant) {
    return {
      statusCode: HttpStatus.OK,
      data: {
        user: tenant,
        tokens: createJwtToken(tenant, this.jwtService),
      },
      notFound: false as const,
    };
  }

  async OAuthCallback(user: GoogleUserDto, res: Response) {
    try {
      const { data, notFound } = await this.oauthLogin(user);
      this.logger.log(
        `OAuthCallback user=${user.email ?? 'unknown'} googleId=${user.googleId ?? 'missing'} notFound=${notFound} tokensReady=${Boolean(data?.tokens?.accessToken && data?.tokens?.refreshToken)}`,
      );

      if (notFound) {
        this.logger.warn(
          'OAuthCallback redirecting to /contact because tenant was not found',
        );
        res.redirect(`${CLIENT_BASE_URL ?? ''}/contact`);
        return;
      }
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
