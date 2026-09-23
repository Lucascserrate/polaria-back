import { AvailabilityCalculator } from '../availability.calculator';
import { BookingAvailabilityService } from './booking-availability.service';
import { ParallelPairs } from '../../scheduling-rules/parallel-pairs';

/**
 * El caso del salón de uñas, de punta a punta por el servicio.
 *
 * Las piezas tienen sus propias pruebas —el planificador, el reparto, el motor
 * de horarios— y esto prueba que están conectadas: que una regla guardada entre
 * dos categorías llega hasta la lista de horarios y hasta la reserva confirmada.
 * Es donde se rompería un cambio que deje al planificador sin las reglas, o que
 * confirme con un plan distinto del que se ofreció.
 *
 * El repositorio está simulado a mano y no con una base: lo único que aporta son
 * los datos del negocio, y montar MySQL para eso convertiría la prueba en algo
 * que nadie corre.
 */

const TENANT = 'tenant-1';
const TIMEZONE = 'America/La_Paz';
const DATE = '2026-09-24';

const MANICURES = 'cat-manicures';
const PEDICURES = 'cat-pedicures';

const ANA = 'staff-ana';
const BETO = 'staff-beto';

const MANICURE_GEL = 'svc-manicure-gel';
const PEDICURE_SPA = 'svc-pedicure-spa';

/** Las 15:00 de La Paz (UTC-4) del día de prueba. */
const at = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, 24, hour + 4, minute));

type Options = {
  /** Quién puede hacer cada servicio. */
  staffByService?: Record<string, string[]>;
  /** Si el negocio declaró que manicures y pedicures conviven. */
  parallel?: boolean;
  /** Citas ya agendadas, por profesional. */
  busy?: Record<string, Array<{ startTime: Date; endTime: Date }>>;
};

function buildService(options: Options = {}) {
  const {
    staffByService = { [MANICURE_GEL]: [ANA], [PEDICURE_SPA]: [BETO] },
    parallel = true,
    busy = {},
  } = options;

  const services = [
    {
      id: MANICURE_GEL,
      categoryId: MANICURES,
      durationMinutes: 60,
      bookingPolicy: 'CLIENT_BOOKS',
    },
    {
      id: PEDICURE_SPA,
      categoryId: PEDICURES,
      durationMinutes: 60,
      bookingPolicy: 'CLIENT_BOOKS',
    },
  ];

  const everyStaff = [ANA, BETO].map((id) => ({
    id,
    usesCustomSchedule: false,
  }));

  const repository = {
    getTenant: jest.fn().mockResolvedValue({ timezone: TIMEZONE }),
    getServices: jest
      .fn()
      .mockImplementation((_tenantId: string, ids: string[]) =>
        Promise.resolve(services.filter((service) => ids.includes(service.id))),
      ),
    getStaffList: jest
      .fn()
      .mockImplementation(
        (_tenantId: string, serviceIds: string[], staffId?: string) => {
          const ids = staffByService[serviceIds[0]] ?? [];
          const kept = staffId ? ids.filter((id) => id === staffId) : ids;
          return Promise.resolve(
            kept.map((id) => ({ id, usesCustomSchedule: false })),
          );
        },
      ),
    // Abierto de 9 a 20 todos los días, para que el horario del local no sea
    // lo que esta prueba ejercita.
    getBusinessHours: jest.fn().mockResolvedValue(
      Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        startTime: '09:00',
        endTime: '20:00',
      })),
    ),
    getStaffSchedules: jest.fn().mockResolvedValue({}),
    getScheduleBlocksByStaff: jest
      .fn()
      .mockResolvedValue(
        Object.fromEntries(everyStaff.map((staff) => [staff.id, []])),
      ),
    getAppointmentsByStaff: jest
      .fn()
      .mockImplementation(
        (_t: string, _d: string, _tz: string, ids: string[]) =>
          Promise.resolve(
            Object.fromEntries(ids.map((id) => [id, busy[id] ?? []])),
          ),
      ),
  };

  const schedulingRules = {
    getParallelPairs: jest
      .fn()
      .mockResolvedValue(
        new ParallelPairs(
          parallel ? [{ categoryAId: MANICURES, categoryBId: PEDICURES }] : [],
        ),
      ),
  };

  const service = new BookingAvailabilityService(
    repository as never,
    new AvailabilityCalculator(),
    schedulingRules as never,
  );

  return { service, repository, schedulingRules };
}

const query = {
  tenantId: TENANT,
  date: DATE,
  items: [{ serviceId: MANICURE_GEL }, { serviceId: PEDICURE_SPA }],
  /*
   * El panel, para que la prueba no dependa de la hora a la que se corre: con
   * `client` no se ofrecen horarios que ya pasaron, y este día es fijo.
   */
  scope: 'panel' as const,
};

/** El horario de las 15:00 dentro de una lista. */
const threePm = <T extends { startTime: Date }>(slots: T[]) =>
  slots.find((slot) => slot.startTime.getTime() === at(15).getTime());

describe('reservar una manicure y una pedicure', () => {
  describe('con dos profesionales libres', () => {
    it('la reserva dura una hora, no dos', async () => {
      const { service } = buildService();

      const slot = threePm(await service.getAvailableSlots(query));

      expect(slot).toBeDefined();
      expect(slot!.endTime).toEqual(at(16));
    });

    it('confirma con una profesional para cada servicio, a la misma hora', async () => {
      const { service } = buildService();

      const confirmation = await service.confirmSlot({
        ...query,
        startTime: at(15),
      });

      expect(confirmation.available).toBe(true);
      if (!confirmation.available) return;

      expect(confirmation.startTime).toEqual(at(15));
      expect(confirmation.endTime).toEqual(at(16));

      expect(confirmation.segments).toEqual([
        {
          serviceId: MANICURE_GEL,
          staffId: ANA,
          startTime: at(15),
          endTime: at(16),
        },
        {
          serviceId: PEDICURE_SPA,
          staffId: BETO,
          startTime: at(15),
          endTime: at(16),
        },
      ]);
    });
  });

  describe('con una sola profesional que puede con las dos cosas', () => {
    const onlyAna = {
      staffByService: { [MANICURE_GEL]: [ANA], [PEDICURE_SPA]: [ANA] },
    };

    it('la reserva sigue existiendo, encadenada y de dos horas', async () => {
      const { service } = buildService(onlyAna);

      const slot = threePm(await service.getAvailableSlots(query));

      expect(slot).toBeDefined();
      expect(slot!.endTime).toEqual(at(17));
    });

    it('confirma los dos servicios con ella, uno detrás del otro', async () => {
      const { service } = buildService(onlyAna);

      const confirmation = await service.confirmSlot({
        ...query,
        startTime: at(15),
      });

      expect(confirmation.available).toBe(true);
      if (!confirmation.available) return;

      expect(confirmation.segments).toEqual([
        {
          serviceId: MANICURE_GEL,
          staffId: ANA,
          startTime: at(15),
          endTime: at(16),
        },
        {
          serviceId: PEDICURE_SPA,
          staffId: ANA,
          startTime: at(16),
          endTime: at(17),
        },
      ]);
    });
  });

  /*
   * La segunda profesional existe pero tiene tomada esa hora. El plan
   * simultáneo no se puede cumplir y el encadenado sí: el horario se ofrece
   * igual, más largo, en vez de desaparecer.
   */
  it('cae al plan encadenado cuando la segunda está ocupada', async () => {
    const { service } = buildService({
      staffByService: { [MANICURE_GEL]: [ANA], [PEDICURE_SPA]: [ANA, BETO] },
      busy: { [BETO]: [{ startTime: at(15), endTime: at(16) }] },
    });

    const confirmation = await service.confirmSlot({
      ...query,
      startTime: at(15),
    });

    expect(confirmation.available).toBe(true);
    if (!confirmation.available) return;

    expect(confirmation.endTime).toEqual(at(17));
    expect(confirmation.segments.map((s) => s.staffId)).toEqual([ANA, ANA]);
  });

  /*
   * Sin la regla cargada, que es el estado en que arranca todo negocio: tiene
   * que comportarse exactamente como antes de que esto existiera.
   */
  describe('sin la regla cargada', () => {
    it('encadena aunque las dos profesionales estén libres', async () => {
      const { service } = buildService({
        parallel: false,
        staffByService: { [MANICURE_GEL]: [ANA], [PEDICURE_SPA]: [ANA, BETO] },
      });

      const slot = threePm(await service.getAvailableSlots(query));

      expect(slot).toBeDefined();
      expect(slot!.endTime).toEqual(at(17));
    });

    /*
     * El modo por defecto exige que una sola persona pueda con toda la reserva,
     * y acá cada una hace una cosa. Que no haya horarios es el comportamiento de
     * siempre, y no cambió: repartir una reserva encadenada sigue habiendo que
     * pedirlo a propósito.
     */
    it('no ofrece nada si nadie puede con los dos servicios', async () => {
      const { service } = buildService({ parallel: false });

      expect(await service.getAvailableSlots(query)).toEqual([]);
    });
  });

  /*
   * La grilla de horarios se arma con la duración del plan **más corto**. El
   * local cierra a las 20:00, así que las 19:00 sólo existen como horario si la
   * reserva puede durar una hora; con la grilla armada sobre el plan encadenado
   * de dos horas, esa hora del día se habría perdido entera.
   */
  it('ofrece la última hora del día, que sólo el plan simultáneo alcanza', async () => {
    const { service } = buildService();

    const slots = await service.getAvailableSlots(query);
    const sevenPm = slots.find(
      (slot) => slot.startTime.getTime() === at(19).getTime(),
    );

    expect(sevenPm).toBeDefined();
    expect(sevenPm!.endTime).toEqual(at(20));
    expect(sevenPm!.endsAfterHours).toBeUndefined();
  });

  /**
   * Lo que el drawer del panel consulta para dibujar los tramos.
   *
   * Es la misma cuenta que hace la creación de la cita, y por eso se pregunta en
   * vez de repetirse en el navegador: mientras estuvo repetida, la pantalla
   * mostraba dos horas y la reserva se escribía en una.
   */
  describe('el reparto que consulta el panel', () => {
    const items = [
      { serviceId: MANICURE_GEL, staffId: ANA },
      { serviceId: PEDICURE_SPA, staffId: BETO },
    ];

    it('con dos profesionales distintas los pone a la misma hora', async () => {
      const { service } = buildService();

      expect(
        await service.resolveBookingLayout({ tenantId: TENANT, items }),
      ).toEqual({ offsetsMinutes: [0, 0], totalDurationMinutes: 60 });
    });

    it('con la misma profesional en los dos los encadena', async () => {
      const { service } = buildService();

      expect(
        await service.resolveBookingLayout({
          tenantId: TENANT,
          items: items.map((item) => ({ ...item, staffId: ANA })),
        }),
      ).toEqual({ offsetsMinutes: [0, 60], totalDurationMinutes: 120 });
    });

    it('sin la regla cargada encadena siempre', async () => {
      const { service } = buildService({ parallel: false });

      expect(
        await service.resolveBookingLayout({ tenantId: TENANT, items }),
      ).toEqual({ offsetsMinutes: [0, 60], totalDurationMinutes: 120 });
    });

    it('sin servicios no hay nada que repartir', async () => {
      const { service } = buildService();

      expect(
        await service.resolveBookingLayout({ tenantId: TENANT, items: [] }),
      ).toEqual({ offsetsMinutes: [], totalDurationMinutes: 0 });
    });
  });
});
