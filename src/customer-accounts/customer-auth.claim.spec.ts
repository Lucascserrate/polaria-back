import type { Request, Response } from 'express';

import { CustomerAuthController } from './customer-auth.controller';
import { CUSTOMER_RETURN_TO_COOKIE } from './customer-google-auth.guard';

/**
 * Qué pasa con el turno de un invitado cuando esa persona inicia sesión.
 *
 * Es el momento en que se cierra el hueco: la cita se creó sin cuenta, y este
 * callback es el único lugar donde se sabe a la vez qué turnos creó **este**
 * navegador —lo dice la cookie— y de quién es la sesión que se acaba de abrir.
 *
 * Por eso lo que se prueba es el cableado y no las piezas: que se consuma la
 * cookie, que se vincule con la cuenta recién resuelta, y sobre todo que nada de
 * esto pueda dejar a alguien sin poder entrar.
 */

const ACCOUNT = 'account-1';

const build = (
  options: { claims?: string[]; linkFails?: boolean; profile?: unknown } = {},
) => {
  const { claims = ['appt-1'], linkFails = false } = options;

  const accounts = {
    findOrCreateByGoogle: jest.fn().mockResolvedValue({ id: ACCOUNT }),
  };
  const session = { setCookie: jest.fn() };
  const bookingClaim = { take: jest.fn().mockReturnValue(claims) };
  const appointments = {
    linkToCustomerAccount: linkFails
      ? jest.fn().mockRejectedValue(new Error('la base se cayó'))
      : jest.fn().mockResolvedValue(claims.length),
  };

  const controller = new CustomerAuthController(
    accounts as never,
    session as never,
    bookingClaim as never,
    appointments as never,
  );

  const req = {
    cookies: { [CUSTOMER_RETURN_TO_COOKIE]: '/historial/appt-1' },
    user:
      'profile' in options ? options.profile : { email: 'alguien@gmail.com' },
  } as unknown as Request;

  const redirected: string[] = [];
  const res = {
    clearCookie: jest.fn(),
    redirect: (url: string) => redirected.push(url),
  } as unknown as Response;

  return {
    controller,
    req,
    res,
    redirected,
    accounts,
    session,
    bookingClaim,
    appointments,
  };
};

describe('adoptar el turno de un invitado al iniciar sesión', () => {
  it('vincula a la cuenta los turnos que dejó este navegador', async () => {
    const { controller, req, res, appointments } = build();

    await controller.googleCallback(req, res);

    expect(appointments.linkToCustomerAccount).toHaveBeenCalledWith({
      appointmentIds: ['appt-1'],
      customerAccountId: ACCOUNT,
    });
  });

  /* Se consume: la cookie no puede quedar viva para el próximo que entre. */
  it('consume la cookie en lugar de sólo leerla', async () => {
    const { controller, req, res, bookingClaim } = build();

    await controller.googleCallback(req, res);

    expect(bookingClaim.take).toHaveBeenCalledWith(req, res);
  });

  it('con el navegador sin turnos pendientes no toca nada', async () => {
    const { controller, req, res, appointments } = build({ claims: [] });

    await controller.googleCallback(req, res);

    expect(appointments.linkToCustomerAccount).not.toHaveBeenCalled();
  });

  /*
   * Lo que no puede pasar: que alguien se quede afuera porque falló algo que
   * no es el login. El turno existe igual y el negocio lo tiene en su agenda.
   */
  it('si la vinculación falla, la sesión se abre igual', async () => {
    const { controller, req, res, redirected, session } = build({
      linkFails: true,
    });

    await expect(controller.googleCallback(req, res)).resolves.not.toThrow();

    expect(session.setCookie).toHaveBeenCalled();
    expect(redirected).toHaveLength(1);
  });

  /* Sin perfil no hay sesión, así que tampoco hay a quién vincularle nada. */
  it('sin perfil de Google no vincula nada', async () => {
    const { controller, req, res, appointments, session } = build({
      profile: undefined,
    });

    await controller.googleCallback(req, res);

    expect(session.setCookie).not.toHaveBeenCalled();
    expect(appointments.linkToCustomerAccount).not.toHaveBeenCalled();
  });

  /* Iniciar sesión termina en el turno, que es de donde salió el ofrecimiento. */
  it('vuelve a donde estaba', async () => {
    const { controller, req, res, redirected } = build();

    await controller.googleCallback(req, res);

    expect(redirected[0]).toContain('/historial/appt-1');
  });
});
