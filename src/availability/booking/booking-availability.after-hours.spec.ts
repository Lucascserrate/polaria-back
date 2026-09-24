import { AvailabilityCalculator } from '../availability.calculator';
import { BookingAvailabilityService } from './booking-availability.service';
import { ParallelPairs } from '../../scheduling-rules/parallel-pairs';

/**
 * El último horario del día, cuando el servicio no termina antes de cerrar.
 *
 * Caso real: una barbería abierta hasta las 22:00, un corte de una hora, y un
 * cliente que a las 21:15 pregunta por WhatsApp. El horario de las 21:30 existe
 * —el local recibe gente hasta las 22:00 y quien atiende termina lo que empezó—
 * y antes se escondía porque la reserva terminaba a las 22:30. La respuesta era
 * "no quedan horarios" con el local abierto y el equipo libre.
 *
 * La fecha es lejana a propósito: con `scope: 'client'` hay un piso de
 * anticipación que se mide contra el reloj real, y una fecha cercana haría que
 * la prueba dependiera del día en que se corre.
 */

const TENANT = 'tenant-1';
const TIMEZONE = 'America/La_Paz';
const DATE = '2030-06-12';
const CORTE = 'svc-corte';
const FABIAN = 'staff-fabian';
const ANA = 'staff-ana';

/** Hora local de La Paz (UTC-4) del día de prueba. */
const at = (hour: number, minute = 0) =>
  new Date(Date.UTC(2030, 5, 12, hour + 4, minute));

function buildService(
  options: {
    staff?: string[];
    busy?: Record<string, Array<{ startTime: Date; endTime: Date }>>;
  } = {},
) {
  const { staff = [FABIAN, ANA], busy = {} } = options;

  const repository = {
    getTenant: jest.fn().mockResolvedValue({ timezone: TIMEZONE }),
    getServices: jest.fn().mockResolvedValue([
      {
        id: CORTE,
        categoryId: null,
        durationMinutes: 60,
        bookingPolicy: 'CLIENT_BOOKS',
      },
    ]),
    getStaffList: jest
      .fn()
      .mockImplementation((_t: string, _s: string[], staffId?: string) =>
        Promise.resolve(
          (staffId ? staff.filter((id) => id === staffId) : staff).map(
            (id) => ({
              id,
              usesCustomSchedule: false,
            }),
          ),
        ),
      ),
    // El local abre 09:00 y cierra 22:00.
    getBusinessHours: jest.fn().mockResolvedValue(
      Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        startTime: '09:00',
        endTime: '22:00',
      })),
    ),
    getStaffSchedules: jest.fn().mockResolvedValue({}),
    getScheduleBlocksByStaff: jest
      .fn()
      .mockResolvedValue(Object.fromEntries(staff.map((id) => [id, []]))),
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
    getParallelPairs: jest.fn().mockResolvedValue(new ParallelPairs([])),
  };

  return new BookingAvailabilityService(
    repository as never,
    new AvailabilityCalculator(),
    schedulingRules as never,
  );
}

/** Lo que pregunta WhatsApp: un servicio, sin preferencia de profesional. */
const query = {
  tenantId: TENANT,
  date: DATE,
  items: [{ serviceId: CORTE }],
  scope: 'client' as const,
};

const find = (slots: Array<{ startTime: Date }>, hour: number, minute = 0) =>
  slots.find((slot) => slot.startTime.getTime() === at(hour, minute).getTime());

describe('reservar cerca del cierre', () => {
  it('ofrece el horario que empieza dentro aunque termine después', async () => {
    const slots = await buildService().getAvailableSlots(query);

    const ultimo = find(slots, 21, 30);
    expect(ultimo).toBeDefined();
    expect(ultimo!.endTime).toEqual(at(22, 30));
  });

  it('lo marca como que se pasa del cierre, sin esconderlo', async () => {
    const slots = await buildService().getAvailableSlots(query);

    expect(find(slots, 21, 30)!.endsAfterHours).toBe(true);
    // El de las 21:00 termina justo al cerrar: ése no lleva marca.
    expect(find(slots, 21, 0)!.endsAfterHours).toBeUndefined();
  });

  it('no ofrece el que arranca después de cerrar', async () => {
    const slots = await buildService().getAvailableSlots(query);

    expect(find(slots, 22, 0)).toBeUndefined();
  });

  /*
   * El caso completo: Fabián tomó las 21:30 con un corte y barba que termina a
   * las 23:00, y el cliente pide un corte sin preferencia. Antes contestaba que
   * no quedan horarios; tiene que ofrecerlo con Ana.
   */
  describe('con un profesional ocupado y otro libre', () => {
    const conFabianOcupado = {
      busy: { [FABIAN]: [{ startTime: at(21, 30), endTime: at(23) }] },
    };

    it('ofrece el horario igual, porque el otro está libre', async () => {
      const slots =
        await buildService(conFabianOcupado).getAvailableSlots(query);

      expect(find(slots, 21, 30)).toBeDefined();
      expect(find(slots, 21, 30)!.eligibleStaffIds).toEqual([ANA]);
    });

    it('lo confirma con el que está libre', async () => {
      const confirmation = await buildService(conFabianOcupado).confirmSlot({
        ...query,
        startTime: at(21, 30),
      });

      expect(confirmation.available).toBe(true);
      if (!confirmation.available) return;

      expect(confirmation.segments[0].staffId).toBe(ANA);
      expect(confirmation.endTime).toEqual(at(22, 30));
    });

    /*
     * Lo que se ofrece se tiene que poder confirmar. Si la revalidación fuera
     * más estricta que la lista, el último horario del día aparecería y después
     * se caería con "ese horario acaba de ocuparse".
     */
    it('confirmar no es más estricto que listar', async () => {
      const service = buildService(conFabianOcupado);

      const slots = await service.getAvailableSlots(query);
      const pasados = slots.filter((slot) => slot.endsAfterHours);
      expect(pasados.length).toBeGreaterThan(0);

      for (const slot of pasados) {
        const confirmation = await service.confirmSlot({
          ...query,
          startTime: slot.startTime,
        });
        expect(confirmation.available).toBe(true);
      }
    });

    it('sin nadie libre no lo ofrece', async () => {
      const slots = await buildService({
        staff: [FABIAN],
        busy: conFabianOcupado.busy,
      }).getAvailableSlots(query);

      expect(find(slots, 21, 30)).toBeUndefined();
    });
  });
});
