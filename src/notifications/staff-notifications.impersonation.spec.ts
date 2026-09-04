import { runImpersonated } from '../auth/impersonation';
import { StaffNotificationsJob } from './staff-notifications.job';

/**
 * Que una sesión de soporte no toque la cola de avisos de los demás negocios.
 *
 * La prueba nace de un daño concreto: la cola es global —`findPending` trae lo
 * más viejo de todos los tenants— y el request que modifica una cita la vacía.
 * Suplantando a una barbería, mover una cita despachaba también los avisos de
 * las otras, y el bloqueo de envíos los cerraba con `markFailed`: perdidos, en
 * silencio y sin que nadie se enterara.
 */
describe('StaffNotificationsJob.flush bajo una sesión de soporte', () => {
  const repository = { findPending: jest.fn() };

  /* Solo se ejercita `flush`, así que el resto de las dependencias no se usa. */
  const build = () =>
    new StaffNotificationsJob(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

  beforeEach(() => repository.findPending.mockReset());

  it('no lee la cola: la deja para el cron', async () => {
    await runImpersonated({ by: 'soporte@polaria.com', tenantId: 't-1' }, () =>
      build().flush(),
    );

    expect(repository.findPending).not.toHaveBeenCalled();
  });

  /*
   * El cron nunca corre dentro de una petición, así que no tiene contexto: es lo
   * que garantiza que postergar no sea perder. Si esto fallara, los avisos no
   * saldrían nunca.
   */
  it('el cron sí despacha, porque no hay sesión de soporte', async () => {
    repository.findPending.mockResolvedValue([]);

    await build().flush();

    expect(repository.findPending).toHaveBeenCalledTimes(1);
  });
});
