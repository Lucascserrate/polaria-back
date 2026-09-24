import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'crypto';
import type { CookieOptions, Request, Response } from 'express';

import { AUTH_COOKIE_OPTIONS } from '../auth/utils/auth-cookies.util';
import { withCookieDomain } from './customer-session';

/**
 * El turno que este navegador acaba de sacar, mientras todavía no tiene dueño.
 *
 * Existe por un hueco concreto: la página pública deja reservar **sin cuenta**
 * —nombre y teléfono, y listo—, así que esa cita nace con `customerAccountId` en
 * `null` y no aparece en el historial de nadie. Si al terminar se ofrece iniciar
 * sesión, hace falta alguna forma de saber que el turno recién hecho es de quien
 * está iniciándola.
 *
 * **La prueba es el navegador, no el teléfono.** Un número es un identificador y
 * no una credencial: cualquiera escribe el de otro. Lo que sí es difícil de
 * fingir es haber sido la sesión de navegador que creó la cita, y eso es lo que
 * guarda esta cookie: firmada, `httpOnly` y de una hora, que es el tiempo que
 * separa "acabo de reservar" de "inicio sesión".
 *
 * **No es un enlace.** Nada de esto viaja en una URL que se pueda reenviar; una
 * cookie `httpOnly` no sale del navegador que la recibió. Es a propósito: se
 * descartó que tener un enlace alcanzara para ver o cancelar un turno.
 *
 * Lo que sí acepta este diseño, dicho de frente: en un dispositivo compartido,
 * quien inicie sesión dentro de esa hora se lleva el turno que dejó sin
 * reclamar quien lo usó antes. Es el mismo trato que cualquier cosa que quede
 * abierta en un navegador prestado, y el `IS NULL` de la consulta impide lo
 * grave —quedarse con un turno que ya tiene dueño—. Ver `linkToCustomerAccount`.
 */
export const BOOKING_CLAIM_COOKIE = 'polariaBooking';

/** Una hora: lo que tarda alguien en reservar y decidirse a iniciar sesión. */
const CLAIM_TTL_SECONDS = 60 * 60;

/**
 * Cuántos turnos sin dueño recuerda el navegador.
 *
 * Más de uno porque reservar dos veces seguidas sin cuenta es normal —dos
 * personas de la misma casa, dos días distintos— y quedarse sólo con el último
 * haría desaparecer el primero del historial sin que nadie se entere. El tope
 * existe para que la cookie no crezca sin límite.
 */
const MAX_CLAIMS = 5;

/**
 * Dominio de firma propio, derivado del secreto de la aplicación igual que el de
 * la sesión de cliente y por las mismas dos razones: no agregar una variable de
 * entorno que se pueda olvidar, y que un token de acá no valga en ningún otro
 * guard. Ver `customer-session.ts`.
 */
const claimSecret = (): string =>
  createHmac('sha256', process.env.SECRET_JWT ?? '')
    .update('polaria:booking-claim:v1')
    .digest('hex');

/** Lo único que lleva: qué turnos creó este navegador. */
interface ClaimPayload {
  ids: string[];
}

const claimCookieOptions = (): CookieOptions =>
  withCookieDomain({
    ...AUTH_COOKIE_OPTIONS,
    httpOnly: true,
    maxAge: CLAIM_TTL_SECONDS * 1000,
  });

@Injectable()
export class BookingClaimService {
  private readonly logger = new Logger(BookingClaimService.name);

  constructor(private readonly jwtService: JwtService) {}

  /**
   * Anota un turno recién creado como "de este navegador".
   *
   * Acumula sobre lo que ya había en lugar de reemplazarlo, y por eso lee la
   * cookie antes de escribirla. El vencimiento se renueva con cada reserva: lo
   * que se está midiendo es el tiempo desde la última, que es cuando la persona
   * está mirando la pantalla que le ofrece iniciar sesión.
   */
  remember(req: Request, res: Response, appointmentId: string): void {
    const ids = [
      ...this.read(req).filter((id) => id !== appointmentId),
      appointmentId,
    ].slice(-MAX_CLAIMS);

    const token = this.jwtService.sign({ ids } satisfies ClaimPayload, {
      secret: claimSecret(),
      expiresIn: CLAIM_TTL_SECONDS,
    });

    res.cookie(BOOKING_CLAIM_COOKIE, token, claimCookieOptions());
  }

  /**
   * Los turnos que este navegador dejó sin dueño, y se olvida de ellos.
   *
   * Consume en lugar de sólo leer: una vez que los turnos pasaron a una cuenta,
   * la cookie no tiene nada más que decir, y dejarla viva sería dejar viva la
   * ventana en la que un dispositivo compartido puede reclamarlos.
   */
  take(req: Request, res: Response): string[] {
    const ids = this.read(req);
    this.clear(res);
    return ids;
  }

  /** Borra la cookie con el mismo dominio con el que se puso. */
  clear(res: Response): void {
    res.clearCookie(
      BOOKING_CLAIM_COOKIE,
      withCookieDomain(AUTH_COOKIE_OPTIONS),
    );
  }

  private read(req: Request): string[] {
    const token = (req.cookies as Record<string, string> | undefined)?.[
      BOOKING_CLAIM_COOKIE
    ];

    if (!token) return [];

    try {
      const payload = this.jwtService.verify<ClaimPayload>(token, {
        secret: claimSecret(),
      });

      return Array.isArray(payload.ids)
        ? payload.ids.filter((id): id is string => typeof id === 'string')
        : [];
    } catch {
      // Vencida o manipulada: para lo que se usa, las dos son "este navegador
      // no reservó nada". Un error acá no puede costar un login.
      this.logger.debug('Cookie de reserva sin dueño ilegible: se ignora.');
      return [];
    }
  }
}
