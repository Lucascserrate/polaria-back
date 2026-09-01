import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import { TenantsService } from '../tenants/tenants.service';
import { Tenant } from '../tenants/entities/tenant.entity';
import { GoogleUserDto } from './dto/google-user.dto';
import { createJwtToken, createStaffJwtToken } from './utils/jwt-token.util';
import { StaffService } from '../staff/staff.service';
import { Staff } from '../staff/entities/staff.entity';
import { actorFrom, type AuthenticatedActor } from './actor';
import { accessStateOf, StaffAccessState } from '../staff/staff-access';
import { StaffAccessRole } from '../staff/staff-role';
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
    private readonly staffService: StaffService,
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
       * El equipo se busca **antes** que el negocio, y el orden es lo que hace que
       * esto funcione.
       *
       * `findOrCreateByGoogleAccount` crea un negocio cuando no encuentra ninguno.
       * Si se consultara primero, un profesional invitado que entra por primera vez
       * no tendría tenant propio y Polaria le crearía una barbería vacía en lugar
       * de meterlo a la de su empleador. Esa era la razón por la que el acceso del
       * equipo no podía existir sin tocar el login.
       *
       * Las dos identidades no pueden solaparse: `grantAccess` rechaza un correo
       * que ya sea de un dueño, así que no hay cuenta que caiga en los dos lados.
       */
      const staff = await this.staffService.findByGoogleAccount({
        googleId: user.googleId,
        email: user.email,
      });

      if (staff) return this.createStaffSession(staff, user.googleId);

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

  /**
   * Sesión de un miembro del equipo.
   *
   * Entrar es lo que acepta la invitación: si todavía no tenía cuenta vinculada, se
   * vincula ahora. No hace falta un paso de aceptación aparte —el negocio ya
   * decidió invitarlo y la persona ya demostró tener el correo— y agregarlo sería
   * una pantalla que solo dice "sí".
   */
  private async createStaffSession(staff: Staff, googleId: string) {
    if (!staff.accessGoogleId) {
      await this.staffService.linkGoogleAccount(staff.id, googleId);
      staff.accessGoogleId = googleId;
    }

    return {
      statusCode: HttpStatus.OK,
      data: {
        user: staff,
        tokens: createStaffJwtToken(staff, this.jwtService),
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
      const payload = this.jwtService.verify<{
        sub: string;
        actorId?: string | null;
      }>(token, { secret: jwtSecret });

      const tenant = await this.tenantsService.findOne(payload.sub);

      if (!tenant) {
        throw new HttpException(TenantError.NOT_FOUND, HttpStatus.UNAUTHORIZED);
      }

      /*
       * Un refresh conserva de quién es la sesión.
       *
       * Sin esto, la sesión de un profesional se renovaría como token de dueño y le
       * abriría el panel completo: sería una escalada de privilegios que llega sola
       * al vencer el token, sin que nadie haga nada raro. Si la ficha desapareció o
       * le revocaron el acceso, la sesión se cierra en lugar de degradarse.
       */
      if (payload.actorId) {
        const staff = await this.staffService.findOne(payload.actorId);

        if (!staff || !staff.isActive || !staff.accessEmail) {
          throw new HttpException(
            AuthError.INVALID_TOKEN,
            HttpStatus.UNAUTHORIZED,
          );
        }

        return {
          statusCode: HttpStatus.OK,
          data: {
            tenant,
            tokens: createStaffJwtToken(staff, this.jwtService),
          },
        };
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
  /**
   * Quién entró: el nombre del negocio, y de la persona si no es el dueño.
   *
   * El nombre que se saluda es el de quien mira, no el del local: un profesional
   * que entra a su agenda no es "Barbería Polaria". El del negocio viaja igual,
   * porque sigue siendo dónde está.
   */
  async getAccount(actor: AuthenticatedActor) {
    const tenant = await this.tenantsService.findOne(actor.tenantId);
    if (!tenant) {
      throw new HttpException(
        TenantError.NOT_AUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
      );
    }

    const staff = actor.staffId
      ? await this.staffService.findOne(actor.staffId)
      : null;

    return {
      name: staff?.name ?? tenant.name,
      email: staff?.accessEmail ?? tenant.email ?? null,
      businessName: tenant.name,
      role: actor.role,
      staffId: actor.staffId,
      // Lo consume la barra de suplantación del panel. Va acá y no en una ruta
      // propia porque es un dato de "quién sos ahora", y esto ya es esa
      // pregunta: una ruta aparte se podría no llamar, y entonces alguien
      // estaría dentro de un negocio ajeno sin que la pantalla lo dijera.
      impersonatedBy: actor.impersonatedBy,
    };
  }

  /**
   * Valida la sesión y dice de quién es.
   *
   * El rol viaja acá y no solo en el token porque el panel necesita saberlo para
   * decidir qué menú dibujar, y el cliente no lee el JWT: la cookie es `httpOnly`,
   * que es justamente lo que evita que se pueda falsear desde el navegador.
   *
   * La ficha se vuelve a consultar en cada validación en lugar de confiar en el
   * token. Es lo que hace que revocar un acceso o desactivar a alguien tenga efecto
   * en el momento y no cuando venza su sesión, que puede ser un mes después.
   */
  async validateTenant(payload: { sub: string; actorId?: string | null }) {
    const tenant = await this.tenantsService.findOne(payload.sub);
    if (!tenant) {
      throw new HttpException(
        TenantError.NOT_AUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
      );
    }

    const actor = actorFrom(payload);

    if (actor.staffId) {
      const staff = await this.staffService.findOne(actor.staffId);

      if (
        !staff ||
        !staff.isActive ||
        accessStateOf(staff) === StaffAccessState.NONE
      ) {
        throw new HttpException(
          AuthError.UNAUTHORIZED,
          HttpStatus.UNAUTHORIZED,
        );
      }

      return {
        statusCode: HttpStatus.OK,
        message: 'Staff is authenticated',
        user: tenant,
        actor: {
          staffId: staff.id,
          name: staff.name,
          role: staff.accessRole,
          providesServices: staff.providesServices,
        },
      };
    }

    return this.authenticatedResponse(tenant);
  }

  private authenticatedResponse(tenant: Tenant) {
    return {
      statusCode: HttpStatus.OK,
      message: 'Tenant is authenticated',
      user: tenant,
      actor: {
        staffId: null,
        name: tenant.name,
        role: StaffAccessRole.OWNER,
        providesServices: false,
      },
    };
  }
}
