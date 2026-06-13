import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CookieOptions, Response } from 'express';
import { TenantsService } from '../tenants/tenants.service';
import { GoogleUserDto } from './dto/google-user.dto';
import { createJwtToken } from './utils/jwt-token.util';
import { AuthError } from './domain/enums/auth.enum';
import { TenantError } from '../tenants/enums/tenant.enum';

const { CLIENT_BASE_URL } = process.env;
const jwtSecret = process.env.SECRET_JWT ?? '';

@Injectable()
export class AuthService {
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
      if (tenant.status && tenant.status !== 'active') {
        return {
          statusCode: HttpStatus.UNAUTHORIZED,
          data: {
            user: tenant,
            tokens: null,
          },
          notActive: true as const,
        };
      }

      const tokens = createJwtToken(tenant, this.jwtService);
      return {
        statusCode: HttpStatus.OK,
        data: {
          user: tenant,
          tokens,
        },
        notFound: false as const,
        notActive: false as const,
      };
    } catch {
      throw new HttpException(
        AuthError.LOGIN_FAILED,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async OAuthCallback(user: GoogleUserDto, res: Response) {
    try {
      const { data, notFound, notActive } = await this.oauthLogin(user);
      const isProd =
        process.env.NODE_ENV === 'prod' ||
        process.env.NODE_ENV === 'production';
      if (notFound) {
        res.redirect(`${CLIENT_BASE_URL ?? ''}/contact`);
        return;
      }
      if (notActive) {
        res.redirect(`${CLIENT_BASE_URL ?? ''}/contact`);
        return;
      }

      const cookieOptions: CookieOptions = {
        secure: true,
        sameSite: 'none',
        path: '/',
      };

      if (isProd) {
        cookieOptions.domain = '.polaria.io';
      }

      res.cookie('accessToken', data.tokens.accessToken, cookieOptions);
      res.cookie('refreshToken', data.tokens.refreshToken, cookieOptions);

      res.redirect(`${CLIENT_BASE_URL}`);
    } catch {
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

    return {
      statusCode: HttpStatus.OK,
      message: 'Tenant is authenticated',
      user: tenant,
    };
  }
}
