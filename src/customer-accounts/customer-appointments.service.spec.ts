import { NotFoundException } from '@nestjs/common';

import { CustomerAppointmentsService } from './customer-appointments.service';
import type { AppointmentsService } from '../appointments/appointments.service';
import type { TenantsService } from '../tenants/tenants.service';
import type { Appointment } from '../appointments/entities/appointment.entity';
import type { Tenant } from '../tenants/entities/tenant.entity';

/*
 * Lo que se prueba acá es la traducción, no la regla.
 *
 * Qué cuenta como turno vigente —ocupa agenda y todavía no empezó— lo decide
 * `AppointmentsService.upcomingWhere`, que es la misma pieza que responde cuando
 * pregunta WhatsApp. Por eso las pruebas miran dos cosas: que se pregunte por la
 * **cuenta** y no por el teléfono, que es de donde sale la seguridad de esto, y
 * que el recorte a lo publicable no deje pasar la entidad entera.
 */

const ACCOUNT_ID = 'account-1';
const TENANT_ID = 'tenant-1';

const tenant = (overrides: Partial<Tenant> = {}): Tenant =>
  ({
    id: TENANT_ID,
    name: 'Royal Barber',
    slug: 'royal-barber',
    timezone: 'America/La_Paz',
    ...overrides,
  }) as unknown as Tenant;

const appointment = (overrides: Partial<Appointment> = {}): Appointment =>
  ({
    id: 'appt-1',
    tenantId: TENANT_ID,
    startTime: new Date('2026-09-24T20:30:00.000Z'),
    endTime: new Date('2026-09-24T21:00:00.000Z'),
    tenant: tenant(),
    services: [{ service: { name: 'Corte' }, staff: { name: 'Fernando' } }],
    ...overrides,
  }) as unknown as Appointment;

const build = (options: {
  appointments?: Appointment[];
  tenant?: Tenant | null;
}) => {
  const findUpcomingByCustomerAccount = jest
    .fn()
    .mockResolvedValue(options.appointments ?? []);

  const findBySlug = jest
    .fn()
    .mockResolvedValue(
      options.tenant === undefined ? tenant() : options.tenant,
    );

  const service = new CustomerAppointmentsService(
    { findUpcomingByCustomerAccount } as unknown as AppointmentsService,
    { findBySlug } as unknown as TenantsService,
  );

  return { service, findUpcomingByCustomerAccount, findBySlug };
};

describe('CustomerAppointmentsService', () => {
  it('pregunta por la cuenta y acota al negocio pedido', async () => {
    const { service, findUpcomingByCustomerAccount } = build({});

    await service.findUpcoming({
      accountId: ACCOUNT_ID,
      businessSlug: 'royal-barber',
    });

    expect(findUpcomingByCustomerAccount).toHaveBeenCalledWith({
      customerAccountId: ACCOUNT_ID,
      tenantId: TENANT_ID,
    });
  });

  /*
   * Sin slug la respuesta es la de toda Polaria. Hoy no hay pantalla que lo
   * pida; la prueba está para que el día que exista no haga falta un segundo
   * endpoint, que es justamente lo que se quiso evitar.
   */
  it('sin negocio no filtra por tenant', async () => {
    const { service, findUpcomingByCustomerAccount, findBySlug } = build({});

    await service.findUpcoming({ accountId: ACCOUNT_ID });

    expect(findBySlug).not.toHaveBeenCalled();
    expect(findUpcomingByCustomerAccount).toHaveBeenCalledWith({
      customerAccountId: ACCOUNT_ID,
      tenantId: undefined,
    });
  });

  it('un slug que no existe es 404 y no una lista vacía', async () => {
    const { service } = build({ tenant: null });

    await expect(
      service.findUpcoming({ accountId: ACCOUNT_ID, businessSlug: 'fantasma' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('recorta el turno a lo que se muestra', async () => {
    const { service } = build({ appointments: [appointment()] });

    const [view] = await service.findUpcoming({
      accountId: ACCOUNT_ID,
      businessSlug: 'royal-barber',
    });

    expect(view).toEqual({
      id: 'appt-1',
      startTime: '2026-09-24T20:30:00.000Z',
      endTime: '2026-09-24T21:00:00.000Z',
      serviceName: 'Corte',
      staffName: 'Fernando',
      business: {
        slug: 'royal-barber',
        name: 'Royal Barber',
        timezone: 'America/La_Paz',
      },
    });
  });

  /*
   * Un turno sin profesional a la vista sigue siendo un turno del que hay que
   * avisar: el aviso existe para que nadie reserve dos veces por olvido, y eso
   * no depende de quién lo atienda.
   */
  it('sin profesional cargado el turno igual sale, con `staffName` en null', async () => {
    const { service } = build({
      appointments: [appointment({ services: [] })],
    });

    const [view] = await service.findUpcoming({
      accountId: ACCOUNT_ID,
      businessSlug: 'royal-barber',
    });

    expect(view.staffName).toBeNull();
    expect(view.serviceName).toBe('Turno');
  });
});
