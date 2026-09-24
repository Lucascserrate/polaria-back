import { ConflictException, NotFoundException } from '@nestjs/common';

import { CustomerAppointmentsService } from './customer-appointments.service';
import { AppointmentStatus } from '../appointments/entities/appointment.entity';
import type { AppointmentsService } from '../appointments/appointments.service';
import type { BusinessPhotosService } from '../business-photos/business-photos.service';
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
    currency: 'BOB',
    address: 'Av. Cristo Redentor 100',
    latitude: -17.75,
    longitude: -63.18,
    ...overrides,
  }) as unknown as Tenant;

/** Un tramo tal como sale de la base, con lo pactado al reservar. */
const segment = (overrides: Record<string, unknown> = {}) =>
  ({
    service: { name: 'Corte' },
    staff: { name: 'Fernando' },
    startTime: new Date('2026-09-24T20:30:00.000Z'),
    endTime: new Date('2026-09-24T21:00:00.000Z'),
    priceAtBooking: '150.00',
    durationAtBooking: 30,
    ...overrides,
  }) as never;

const appointment = (overrides: Partial<Appointment> = {}): Appointment =>
  ({
    id: 'appt-1',
    tenantId: TENANT_ID,
    status: AppointmentStatus.CONFIRMED,
    startTime: new Date('2026-09-24T20:30:00.000Z'),
    endTime: new Date('2026-09-24T21:00:00.000Z'),
    tenant: tenant(),
    services: [segment()],
    ...overrides,
  }) as unknown as Appointment;

const build = (options: {
  appointments?: Appointment[];
  past?: Appointment[];
  one?: Appointment | null;
  tenant?: Tenant | null;
  /** La portada del negocio, si tiene alguna foto subida. */
  cover?: string | null;
}) => {
  const findUpcomingByCustomerAccount = jest
    .fn()
    .mockResolvedValue(options.appointments ?? []);

  const findPastByCustomerAccount = jest
    .fn()
    .mockResolvedValue(options.past ?? []);

  const findByCustomerAccountAndId = jest
    .fn()
    .mockResolvedValue(options.one === undefined ? appointment() : options.one);

  const cancelByCustomerAccount = jest.fn().mockResolvedValue(null);

  const findBySlug = jest
    .fn()
    .mockResolvedValue(
      options.tenant === undefined ? tenant() : options.tenant,
    );

  const covers = jest
    .fn()
    .mockResolvedValue(
      options.cover
        ? new Map([[TENANT_ID, { url: options.cover }]])
        : new Map(),
    );

  const service = new CustomerAppointmentsService(
    {
      findUpcomingByCustomerAccount,
      findPastByCustomerAccount,
      findByCustomerAccountAndId,
      cancelByCustomerAccount,
    } as unknown as AppointmentsService,
    { findBySlug } as unknown as TenantsService,
    { covers } as unknown as BusinessPhotosService,
  );

  return {
    service,
    findUpcomingByCustomerAccount,
    findPastByCustomerAccount,
    findByCustomerAccountAndId,
    cancelByCustomerAccount,
    findBySlug,
    covers,
  };
};

/*
 * Los dos lados de la única regla de cancelar. Se calculan contra el reloj real
 * y no con fechas escritas: la frontera es "ya empezó", así que una fecha fija
 * cambiaría de lado el día que llegue.
 */
const upcoming = () =>
  appointment({
    startTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
    endTime: new Date(Date.now() + 3 * 60 * 60 * 1000),
  });

const started = () =>
  appointment({
    startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
    endTime: new Date(Date.now() - 60 * 60 * 1000),
  });

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
   * Sin slug la respuesta es la de toda Polaria: es la que lee el historial de
   * la cuenta, que mezcla negocios.
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
    const { service } = build({
      appointments: [appointment()],
      cover: 'https://cdn/portada.jpg',
    });

    const [view] = await service.findUpcoming({
      accountId: ACCOUNT_ID,
      businessSlug: 'royal-barber',
    });

    expect(view).toEqual({
      id: 'appt-1',
      startTime: '2026-09-24T20:30:00.000Z',
      endTime: '2026-09-24T21:00:00.000Z',
      status: AppointmentStatus.CONFIRMED,
      serviceName: 'Corte',
      staffName: 'Fernando',
      business: {
        slug: 'royal-barber',
        name: 'Royal Barber',
        timezone: 'America/La_Paz',
        photoUrl: 'https://cdn/portada.jpg',
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

  /*
   * La relación llega sin orden desde la base. Sin ordenarla, el título de la
   * tarjeta y el desglose del detalle nombraban los mismos servicios al revés.
   */
  it('nombra los servicios en orden de atención', async () => {
    const { service } = build({
      appointments: [
        appointment({
          services: [
            segment({
              service: { name: 'Corte' },
              startTime: new Date('2026-09-24T21:00:00.000Z'),
            }),
            segment({ service: { name: 'Barba' } }),
          ],
        }),
      ],
    });

    const [view] = await service.findUpcoming({ accountId: ACCOUNT_ID });

    expect(view.serviceName).toBe('Barba y Corte');
  });

  /* Un negocio sin fotos tiene que dar una tarjeta igual, sin portada. */
  it('sin foto el negocio viaja con `photoUrl` en null', async () => {
    const { service } = build({ appointments: [appointment()] });

    const [view] = await service.findUpcoming({ accountId: ACCOUNT_ID });

    expect(view.business.photoUrl).toBeNull();
  });

  /*
   * Diez turnos del mismo local son una sola consulta de fotos. Es la razón por
   * la que las portadas se piden en lote y no dentro del `map`.
   */
  it('pide las portadas una sola vez para toda la lista', async () => {
    const { service, covers } = build({
      appointments: [appointment(), appointment({ id: 'appt-2' })],
    });

    await service.findUpcoming({ accountId: ACCOUNT_ID });

    expect(covers).toHaveBeenCalledTimes(1);
    expect(covers).toHaveBeenCalledWith([TENANT_ID]);
  });

  /* Sin turnos no hay negocios que resolver: ni una consulta de fotos. */
  it('con la lista vacía no pregunta por fotos', async () => {
    const { service, covers } = build({ appointments: [] });

    await expect(
      service.findUpcoming({ accountId: ACCOUNT_ID }),
    ).resolves.toEqual([]);
    expect(covers).not.toHaveBeenCalled();
  });

  describe('el historial', () => {
    it('pregunta por la cuenta, igual que lo vigente', async () => {
      const { service, findPastByCustomerAccount } = build({});

      await service.findPast({ accountId: ACCOUNT_ID });

      expect(findPastByCustomerAccount).toHaveBeenCalledWith({
        customerAccountId: ACCOUNT_ID,
        tenantId: undefined,
      });
    });

    /*
     * El estado es lo único que distingue en la lista al que se atendió del que
     * se canceló. Sin él las dos tarjetas se leen iguales.
     */
    it('lleva el estado de cada turno', async () => {
      const { service } = build({
        past: [appointment({ status: AppointmentStatus.CANCELLED })],
      });

      const [view] = await service.findPast({ accountId: ACCOUNT_ID });

      expect(view.status).toBe(AppointmentStatus.CANCELLED);
    });
  });

  describe('cancelar', () => {
    it('cancela el turno de la cuenta', async () => {
      const { service, cancelByCustomerAccount } = build({ one: upcoming() });

      await service.cancel({
        accountId: ACCOUNT_ID,
        appointmentId: 'appt-1',
      });

      expect(cancelByCustomerAccount).toHaveBeenCalledWith({
        customerAccountId: ACCOUNT_ID,
        appointmentId: 'appt-1',
      });
    });

    /*
     * Devuelve el turno y no un `ok`: la pantalla que lo pidió lo está mostrando
     * y se redibuja con lo que vuelve, sin una segunda consulta.
     */
    it('devuelve el turno para que la pantalla se redibuje', async () => {
      const { service } = build({ one: upcoming() });

      const detail = await service.cancel({
        accountId: ACCOUNT_ID,
        appointmentId: 'appt-1',
      });

      expect(detail.id).toBe('appt-1');
      expect(detail.services).toHaveLength(1);
    });

    it('un turno ajeno o inexistente es 404', async () => {
      const { service, cancelByCustomerAccount } = build({ one: null });

      await expect(
        service.cancel({ accountId: ACCOUNT_ID, appointmentId: 'appt-9' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(cancelByCustomerAccount).not.toHaveBeenCalled();
    });

    /*
     * Un turno que ya pasó no se cancela: no libera nada, y dejar que el cliente
     * lo marque como cancelado le reescribiría al negocio el registro de una
     * ausencia. El 409 —y no un 404— es para que la pantalla pueda decir cuál de
     * las dos cosas pasó.
     */
    it('un turno que ya empezó es 409 y no se toca', async () => {
      const { service, cancelByCustomerAccount } = build({ one: started() });

      await expect(
        service.cancel({ accountId: ACCOUNT_ID, appointmentId: 'appt-1' }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(cancelByCustomerAccount).not.toHaveBeenCalled();
    });
  });

  describe('el detalle de un turno', () => {
    it('trae el desglose con lo pactado al reservar', async () => {
      const { service } = build({});

      const detail = await service.findOne({
        accountId: ACCOUNT_ID,
        appointmentId: 'appt-1',
      });

      expect(detail.services).toEqual([
        {
          name: 'Corte',
          staffName: 'Fernando',
          startTime: '2026-09-24T20:30:00.000Z',
          durationMinutes: 30,
          price: 150,
        },
      ]);
      expect(detail.total).toBe(150);
      expect(detail.currency).toBe('BOB');
      expect(detail.durationMinutes).toBe(30);
      expect(detail.address).toBe('Av. Cristo Redentor 100');
      expect(detail.location).toEqual({ latitude: -17.75, longitude: -63.18 });
    });

    /* La pertenencia la impone la consulta; acá se verifica que se la pida. */
    it('pregunta por el turno acotado a la cuenta', async () => {
      const { service, findByCustomerAccountAndId } = build({});

      await service.findOne({ accountId: ACCOUNT_ID, appointmentId: 'appt-1' });

      expect(findByCustomerAccountAndId).toHaveBeenCalledWith({
        customerAccountId: ACCOUNT_ID,
        appointmentId: 'appt-1',
      });
    });

    it('un turno ajeno o inexistente es 404', async () => {
      const { service } = build({ one: null });

      await expect(
        service.findOne({ accountId: ACCOUNT_ID, appointmentId: 'appt-9' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    /*
     * La misma regla que el resumen de la reserva: con un servicio que se
     * cotiza, el total es `null` y no la suma de los otros. Un número que deja
     * afuera un servicio se lee como lo que se paga, y no lo es.
     */
    it('con un servicio que se cotiza el total es null', async () => {
      const { service } = build({
        one: appointment({
          services: [
            segment(),
            segment({
              service: { name: 'Color' },
              priceAtBooking: null,
              startTime: new Date('2026-09-24T21:00:00.000Z'),
            }),
          ],
        }),
      });

      const detail = await service.findOne({
        accountId: ACCOUNT_ID,
        appointmentId: 'appt-1',
      });

      expect(detail.total).toBeNull();
      expect(detail.services[1].price).toBeNull();
    });

    /*
     * Con servicios en paralelo el bloque dura menos que la suma de los
     * servicios, y lo que ocupa la tarde de alguien es el bloque.
     */
    it('la duración es la del bloque, no la suma de los servicios', async () => {
      const { service } = build({
        one: appointment({
          endTime: new Date('2026-09-24T21:00:00.000Z'),
          services: [
            segment({ durationAtBooking: 30 }),
            segment({ service: { name: 'Manicura' }, durationAtBooking: 30 }),
          ],
        }),
      });

      const detail = await service.findOne({
        accountId: ACCOUNT_ID,
        appointmentId: 'appt-1',
      });

      expect(detail.durationMinutes).toBe(30);
    });

    /* Los servicios salen en orden de atención, no en el que los trajo la base. */
    it('ordena los servicios por su hora de inicio', async () => {
      const { service } = build({
        one: appointment({
          services: [
            segment({
              service: { name: 'Barba' },
              startTime: new Date('2026-09-24T21:00:00.000Z'),
            }),
            segment(),
          ],
        }),
      });

      const detail = await service.findOne({
        accountId: ACCOUNT_ID,
        appointmentId: 'appt-1',
      });

      expect(detail.services.map((item) => item.name)).toEqual([
        'Corte',
        'Barba',
      ]);
    });

    /* Media coordenada no ubica nada: dibujaría un marcador en el ecuador. */
    it('sin las dos coordenadas no manda ubicación', async () => {
      const { service } = build({
        one: appointment({ tenant: tenant({ longitude: null }) }),
      });

      const detail = await service.findOne({
        accountId: ACCOUNT_ID,
        appointmentId: 'appt-1',
      });

      expect(detail.location).toBeNull();
    });
  });
});
