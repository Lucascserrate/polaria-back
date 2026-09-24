import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';

import { BOOKING_CLAIM_COOKIE, BookingClaimService } from './booking-claim';

/**
 * La prueba de que un navegador creó un turno.
 *
 * Es lo único que separa "quien reservó como invitado y después inició sesión
 * encuentra su turno" de "cualquiera que mande un id se queda con el turno de
 * otro", así que lo que se prueba acá es sobre todo lo que **no** tiene que
 * pasar: una cookie firmada con otro secreto, una manipulada o una que no está
 * valen todas lo mismo que no haber reservado.
 */

const SECRET = 'un-secreto-de-prueba';

/** El doble de Express: guarda lo que se le pone y lo que se le borra. */
const buildRes = () => {
  const cookies = new Map<string, string>();
  const cleared: string[] = [];

  return {
    cookies,
    cleared,
    res: {
      cookie: (name: string, value: string) => cookies.set(name, value),
      clearCookie: (name: string) => cleared.push(name),
    } as unknown as Response,
  };
};

const reqWith = (cookies: Record<string, string>) =>
  ({ cookies }) as unknown as Request;

const build = () => {
  process.env.SECRET_JWT = SECRET;
  return new BookingClaimService(new JwtService({}));
};

describe('BookingClaimService', () => {
  it('recuerda el turno recién creado y lo devuelve al iniciar sesión', () => {
    const service = build();
    const { res, cookies } = buildRes();

    service.remember(reqWith({}), res, 'appt-1');

    const taken = service.take(
      reqWith({ [BOOKING_CLAIM_COOKIE]: cookies.get(BOOKING_CLAIM_COOKIE)! }),
      buildRes().res,
    );

    expect(taken).toEqual(['appt-1']);
  });

  /*
   * Reservar dos veces seguidas sin cuenta es normal —dos personas de la misma
   * casa—, y quedarse sólo con el último haría desaparecer el primero.
   */
  it('acumula varios turnos del mismo navegador', () => {
    const service = build();
    const { res, cookies } = buildRes();

    service.remember(reqWith({}), res, 'appt-1');
    service.remember(
      reqWith({ [BOOKING_CLAIM_COOKIE]: cookies.get(BOOKING_CLAIM_COOKIE)! }),
      res,
      'appt-2',
    );

    expect(
      service.take(
        reqWith({ [BOOKING_CLAIM_COOKIE]: cookies.get(BOOKING_CLAIM_COOKIE)! }),
        buildRes().res,
      ),
    ).toEqual(['appt-1', 'appt-2']);
  });

  it('no repite el mismo turno si se anota dos veces', () => {
    const service = build();
    const { res, cookies } = buildRes();

    service.remember(reqWith({}), res, 'appt-1');
    service.remember(
      reqWith({ [BOOKING_CLAIM_COOKIE]: cookies.get(BOOKING_CLAIM_COOKIE)! }),
      res,
      'appt-1',
    );

    expect(
      service.take(
        reqWith({ [BOOKING_CLAIM_COOKIE]: cookies.get(BOOKING_CLAIM_COOKIE)! }),
        buildRes().res,
      ),
    ).toEqual(['appt-1']);
  });

  /* El tope existe para que la cookie no crezca sin límite. */
  it('se queda con los últimos cinco', () => {
    const service = build();
    const { res, cookies } = buildRes();

    for (let i = 1; i <= 7; i += 1) {
      service.remember(
        reqWith({
          ...(cookies.has(BOOKING_CLAIM_COOKIE)
            ? { [BOOKING_CLAIM_COOKIE]: cookies.get(BOOKING_CLAIM_COOKIE)! }
            : {}),
        }),
        res,
        `appt-${i}`,
      );
    }

    expect(
      service.take(
        reqWith({ [BOOKING_CLAIM_COOKIE]: cookies.get(BOOKING_CLAIM_COOKIE)! }),
        buildRes().res,
      ),
    ).toEqual(['appt-3', 'appt-4', 'appt-5', 'appt-6', 'appt-7']);
  });

  it('sin cookie no hay nada que reclamar', () => {
    expect(build().take(reqWith({}), buildRes().res)).toEqual([]);
  });

  /*
   * El caso que importa: un id que alguien escribió a mano en la cookie no
   * vale, porque no está firmado con nuestro secreto.
   */
  it('una cookie inventada no reclama nada', () => {
    const service = build();

    const inventada = new JwtService({}).sign(
      { ids: ['turno-ajeno'] },
      { secret: 'otro-secreto' },
    );

    expect(
      service.take(
        reqWith({ [BOOKING_CLAIM_COOKIE]: inventada }),
        buildRes().res,
      ),
    ).toEqual([]);
  });

  it('una cookie manoseada tampoco', () => {
    const service = build();
    const { res, cookies } = buildRes();
    service.remember(reqWith({}), res, 'appt-1');

    const roto = `${cookies.get(BOOKING_CLAIM_COOKIE)!.slice(0, -3)}xyz`;

    expect(
      service.take(reqWith({ [BOOKING_CLAIM_COOKIE]: roto }), buildRes().res),
    ).toEqual([]);
  });

  /*
   * Se consume, no se lee: dejarla viva sería dejar viva la ventana en la que
   * un dispositivo compartido puede reclamar el turno de quien lo usó antes.
   */
  it('al reclamar borra la cookie', () => {
    const service = build();
    const { res, cookies } = buildRes();
    service.remember(reqWith({}), res, 'appt-1');

    const target = buildRes();
    service.take(
      reqWith({ [BOOKING_CLAIM_COOKIE]: cookies.get(BOOKING_CLAIM_COOKIE)! }),
      target.res,
    );

    expect(target.cleared).toContain(BOOKING_CLAIM_COOKIE);
  });

  /* Un token de la sesión de cliente no sirve acá: son dominios de firma
   * distintos, derivados con etiquetas distintas del mismo secreto. */
  it('el token de la sesión de cliente no vale como reclamo', () => {
    const service = build();

    const { createHmac } = require('crypto') as typeof import('crypto');
    const sesion = new JwtService({}).sign(
      { ids: ['appt-1'] },
      {
        secret: createHmac('sha256', SECRET)
          .update('polaria:customer-session:v1')
          .digest('hex'),
      },
    );

    expect(
      service.take(reqWith({ [BOOKING_CLAIM_COOKIE]: sesion }), buildRes().res),
    ).toEqual([]);
  });
});
