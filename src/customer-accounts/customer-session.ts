import { createHmac } from 'crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { CookieOptions, Request, Response } from 'express';
import { AUTH_COOKIE_OPTIONS } from '../auth/utils/auth-cookies.util';

/**
 * La sesión de quien reserva, que **no** es la del negocio.
 *
 * Son dos sujetos distintos y por eso no comparten nada: ni cookie, ni secreto,
 * ni guard. La del panel lleva en `sub` el `tenantId` —lo leen unos veinte
 * controladores—, así que un token de cliente que entrara por ese camino sería
 * leído como un negocio con el id de una persona. Con dos secretos distintos eso
 * ni siquiera llega a ser una pregunta: el token de un cliente **no valida** en
 * el guard del panel, y el del panel no valida acá.
 */
export const CUSTOMER_COOKIE = 'customerToken';

const logger = new Logger('CustomerSession');

/**
 * Un mes. Los clientes no vuelven cada día, y una sesión que caduca en dos horas
 * convierte el login en un trámite que hay que repetir justo cuando se quiere
 * reservar rápido.
 */
export const CUSTOMER_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * El secreto se **deriva** del de la aplicación en lugar de ser una variable
 * nueva.
 *
 * Dos razones. Una: no hay que acordarse de configurar nada en cada despliegue,
 * y una variable que falta en producción es una caída. La otra es la que
 * importa: derivarlo con HMAC y una etiqueta fija da un dominio de firma
 * separado del de las sesiones del panel, que es lo que hace imposible usar un
 * token de un lado en el otro.
 */
const customerSecret = (): string =>
  createHmac('sha256', process.env.SECRET_JWT ?? '')
    .update('polaria:customer-session:v1')
    .digest('hex');

/**
 * El dominio de la cookie, y por qué hace falta declararlo.
 *
 * La sesión la emite la API (`api.polariahq.com`) pero la tiene que **leer el
 * sitio público** (`polariahq.com`) al renderizar la página de reservas: es así
 * como el HTML llega sabiendo si mostrar el botón de Google o el resumen. Una
 * cookie sin dominio queda atada al host que la emitió, así que el sitio no la
 * vería nunca y todo el mundo parecería recién llegado.
 *
 * Con `COOKIE_DOMAIN=.polariahq.com` la comparten los dos subdominios. Se deja
 * sin definir en desarrollo a propósito: ahí la API y el sitio son dos puertos
 * del mismo `localhost` —las cookies no distinguen puerto— y ponerle un dominio
 * a mano solo daría problemas.
 */
/**
 * Agrega `domain` **sólo si hay uno**, en lugar de pasarlo como `undefined`.
 *
 * No es una preferencia de estilo: la librería `cookie` que usa Express valida
 * el dominio en cuanto la clave existe en el objeto, aunque su valor sea
 * `undefined`, y tira `TypeError: option domain is invalid`. Con
 * `COOKIE_DOMAIN` vacío —que es lo normal en desarrollo— eso rompía tanto abrir
 * como cerrar sesión, y el error salía en el borrado de la cookie, lejos de la
 * causa.
 */
export const withCookieDomain = (base: CookieOptions): CookieOptions => {
  const domain = readCookieDomain();

  return domain ? { ...base, domain } : { ...base };
};

/**
 * El dominio configurado, si es un dominio de verdad.
 *
 * Se valida porque el nombre de la variable invita a poner la dirección del
 * sitio, y un dominio de cookie no es una URL: no lleva esquema, ni puerto, ni
 * ruta. Con `localhost:3000` ahí, Express rechaza la cookie con
 * `TypeError: option domain is invalid` **al emitirla y al borrarla**, así que
 * el síntoma es que no se puede iniciar ni cerrar sesión, y el mensaje no
 * menciona la variable que lo causó.
 *
 * Ante un valor inválido se ignora y se avisa, en lugar de romper: una
 * credencial mal escrita no debería dejar sin login a todo el sitio, y el aviso
 * es lo que hace que el problema se encuentre en un minuto.
 */
const readCookieDomain = (): string | undefined => {
  const raw = process.env.COOKIE_DOMAIN?.trim();
  if (!raw) return undefined;

  // Un punto inicial —`.polariahq.com`— es válido: significa "y subdominios".
  if (!/^\.?[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(raw)) {
    logger.warn(
      `COOKIE_DOMAIN="${raw}" no es un dominio válido para una cookie: no puede llevar puerto, esquema ni ruta. Se ignora, y la sesión queda atada al host que la emite. En producción tiene que ser algo como ".polariahq.com".`,
    );
    return undefined;
  }

  return raw;
};

const customerCookieOptions = (): CookieOptions =>
  withCookieDomain({
    ...AUTH_COOKIE_OPTIONS,
    httpOnly: true,
    maxAge: CUSTOMER_SESSION_TTL_SECONDS * 1000,
  });

/** Lo único que lleva el token: de quién es la sesión. */
interface CustomerTokenPayload {
  sub: string;
}

@Injectable()
export class CustomerSessionService {
  constructor(private readonly jwtService: JwtService) {}

  sign(accountId: string): string {
    return this.jwtService.sign(
      { sub: accountId } satisfies CustomerTokenPayload,
      {
        secret: customerSecret(),
        expiresIn: CUSTOMER_SESSION_TTL_SECONDS,
      },
    );
  }

  /**
   * El id de la cuenta que trae la petición, o `null`.
   *
   * Devuelve `null` en lugar de lanzar porque hay dos usos y solo uno es una
   * puerta cerrada: la página de reservas necesita saber **si** hay sesión para
   * decidir qué mostrar, y ahí no haber iniciado sesión no es un error. Para lo
   * que sí requiere sesión está `CustomerGuard`, que sí lanza.
   */
  read(req: Request): string | null {
    const token = (req.cookies as Record<string, string> | undefined)?.[
      CUSTOMER_COOKIE
    ];

    if (!token) return null;

    try {
      const payload = this.jwtService.verify<CustomerTokenPayload>(token, {
        secret: customerSecret(),
      });

      return payload.sub || null;
    } catch {
      // Vencido, manipulado, o emitido con otro secreto —el del panel, por
      // ejemplo—. En todos los casos es una petición sin sesión de cliente.
      return null;
    }
  }

  setCookie(res: Response, accountId: string): void {
    res.cookie(CUSTOMER_COOKIE, this.sign(accountId), customerCookieOptions());
  }

  clearCookie(res: Response): void {
    // Mismo dominio que al emitirla: una cookie de `.polariahq.com` no se borra
    // con un `clearCookie` sin dominio, y la sesión seguiría viva.
    res.clearCookie(CUSTOMER_COOKIE, withCookieDomain(AUTH_COOKIE_OPTIONS));
  }
}

/** Para lo que no se puede hacer sin haber iniciado sesión como cliente. */
@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(private readonly session: CustomerSessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { customerAccountId?: string }>();

    const accountId = this.session.read(request);
    if (!accountId) {
      throw new UnauthorizedException('Iniciá sesión para continuar.');
    }

    request.customerAccountId = accountId;
    return true;
  }
}

/** El id de la cuenta, ya validado por `CustomerGuard`. */
export const CustomerAccountId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context
      .switchToHttp()
      .getRequest<Request & { customerAccountId?: string }>();

    return request.customerAccountId ?? '';
  },
);
