import { ConfigService } from '@nestjs/config';

import { runImpersonated } from '../auth/impersonation';
import { WhatsAppSenderService } from './whatsapp-sender.service';

/**
 * El sello que impide que una sesión de soporte le escriba a un cliente real.
 *
 * Es la prueba que más importa de todo el mecanismo de suplantación: el resto
 * —la cookie, la barra, el log— se nota si falla, y esto no. Un envío que se
 * escapa llega al teléfono de alguien que no sabe que hay soporte adentro, y no
 * hay forma de deshacerlo.
 */
describe('WhatsAppSenderService bajo una sesión de soporte', () => {
  const credentials = { accessToken: 'token', phoneNumberId: '123' };
  const input = { to: '+59179995002', body: 'hola' };

  const build = () => new WhatsAppSenderService(new ConfigService());

  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), {
        status: 200,
      }),
    );
  });

  afterEach(() => fetchSpy.mockRestore());

  it('no llama a Meta y devuelve el motivo', async () => {
    const result = await runImpersonated(
      { by: 'soporte@polaria.com', tenantId: 'tenant-1' },
      () => build().sendText(credentials, input),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: 'IMPERSONATION_BLOCKED' });
  });

  /*
   * El bloqueo tiene que valer también para lo que Polaria inicia por su cuenta
   * —los avisos al equipo salen por plantilla—, que es justamente lo que se
   * dispara sin que nadie lo haya pedido al mover una cita.
   */
  it('tampoco deja pasar las plantillas', async () => {
    const result = await runImpersonated(
      { by: 'soporte@polaria.com', tenantId: 'tenant-1' },
      () =>
        build().sendTemplate(credentials, {
          to: input.to,
          name: 'staff_alert_new',
          languageCode: 'es',
        }),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  /*
   * Fuera de una sesión de soporte no hay contexto, y ese es el caso normal:
   * jobs, webhooks y el negocio usando su propio panel. Si esto fallara, el
   * bloqueo habría dejado a Polaria muda para todos.
   */
  it('envía con normalidad fuera de una sesión de soporte', async () => {
    const result = await build().sendText(credentials, input);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });
});
