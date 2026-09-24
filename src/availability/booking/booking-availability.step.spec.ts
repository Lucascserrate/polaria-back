import { AvailabilityCalculator } from '../availability.calculator';
import { BookingAvailabilityService } from './booking-availability.service';
import { ParallelPairs } from '../../scheduling-rules/parallel-pairs';
import { FINE_SLOT_STEP_MINUTES } from './booking-slot.type';

/**
 * Cada cuánto se ofrece un horario, según quién pregunta.
 *
 * El paso dejó de ser uno solo para todos: lo elige el canal, porque depende de
 * cuántos horarios entran en su componente. Lo que se prueba acá es que el motor
 * lo respete y, sobre todo, que listar y confirmar no puedan quedar con pasos
 * distintos sin que se note.
 */

const TENANT = 'tenant-1';
const TIMEZONE = 'America/La_Paz';
const DATE = '2026-09-24';
const SERVICE = 'svc-corte';
const ANA = 'staff-ana';

/** Hora local de La Paz (UTC-4) del día de prueba. */
const at = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, 24, hour + 4, minute));

function buildService(busy: Array<{ startTime: Date; endTime: Date }> = []) {
  const repository = {
    getTenant: jest.fn().mockResolvedValue({ timezone: TIMEZONE }),
    getServices: jest.fn().mockResolvedValue([
      {
        id: SERVICE,
        categoryId: null,
        durationMinutes: 30,
        bookingPolicy: 'CLIENT_BOOKS',
      },
    ]),
    getStaffList: jest
      .fn()
      .mockResolvedValue([{ id: ANA, usesCustomSchedule: false }]),
    getBusinessHours: jest.fn().mockResolvedValue(
      Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        startTime: '09:00',
        endTime: '12:00',
      })),
    ),
    getStaffSchedules: jest.fn().mockResolvedValue({}),
    getScheduleBlocksByStaff: jest.fn().mockResolvedValue({ [ANA]: [] }),
    getAppointmentsByStaff: jest.fn().mockResolvedValue({ [ANA]: busy }),
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

const query = {
  tenantId: TENANT,
  date: DATE,
  items: [{ serviceId: SERVICE }],
  // El panel, para que la prueba no dependa de la hora a la que se corre.
  scope: 'panel' as const,
};

const startsOf = (slots: Array<{ startTime: Date }>) =>
  slots.map((slot) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(slot.startTime),
  );

describe('el paso entre horarios lo elige el canal', () => {
  it('sin pedir nada usa media hora, que es lo que hacía para todos', async () => {
    const slots = await buildService().getAvailableSlots(query);

    expect(startsOf(slots)).toEqual([
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
      '11:30',
    ]);
  });

  it('con paso fino ofrece también los cuartos de hora', async () => {
    const slots = await buildService().getAvailableSlots({
      ...query,
      stepMinutes: FINE_SLOT_STEP_MINUTES,
    });

    expect(startsOf(slots)).toEqual([
      '09:00',
      '09:15',
      '09:30',
      '09:45',
      '10:00',
      '10:15',
      '10:30',
      '10:45',
      '11:00',
      '11:15',
      '11:30',
      // Empieza antes de cerrar y termina después: el panel lo ofrece marcado.
      '11:45',
    ]);
  });

  /*
   * El paso decide cada cuánto se ofrece un horario, no hasta cuándo. El último
   * que entra entero sigue siendo el mismo con los dos, y el que se pasa del
   * cierre sigue apareciendo sólo para el panel y marcado.
   */
  it('el paso no cambia qué entra antes de cerrar', async () => {
    const service = buildService();

    const [grueso, fino] = await Promise.all([
      service.getAvailableSlots(query),
      service.getAvailableSlots({
        ...query,
        stepMinutes: FINE_SLOT_STEP_MINUTES,
      }),
    ]);

    const entero = (
      slots: Awaited<ReturnType<typeof service.getAvailableSlots>>,
    ) => startsOf(slots.filter((slot) => !slot.endsAfterHours)).at(-1);

    expect(entero(grueso)).toBe('11:30');
    expect(entero(fino)).toBe('11:30');
  });

  describe('confirmar usa la misma grilla que listar', () => {
    it('confirma un horario del paso fino cuando se pide con el mismo paso', async () => {
      const confirmation = await buildService().confirmSlot({
        ...query,
        stepMinutes: FINE_SLOT_STEP_MINUTES,
        startTime: at(9, 15),
      });

      expect(confirmation.available).toBe(true);
    });

    /*
     * La razón de que el paso viaje junto a los servicios y no se escriba en
     * cada consulta: con pasos distintos, un horario que la pantalla ofreció no
     * existe al confirmarlo, y el cliente recibe "ese horario acaba de
     * ocuparse" sin que nadie lo haya ocupado.
     */
    it('no encuentra las 09:15 si confirma con el paso grueso', async () => {
      const confirmation = await buildService().confirmSlot({
        ...query,
        startTime: at(9, 15),
      });

      expect(confirmation.available).toBe(false);
    });

    it('las horas en punto existen con los dos pasos', async () => {
      const grueso = await buildService().confirmSlot({
        ...query,
        startTime: at(10),
      });
      const fino = await buildService().confirmSlot({
        ...query,
        stepMinutes: FINE_SLOT_STEP_MINUTES,
        startTime: at(10),
      });

      expect(grueso.available).toBe(true);
      expect(fino.available).toBe(true);
    });
  });

  /**
   * El horario que arranca justo cuando alguien se libera.
   *
   * Es lo que hace que el paso deje de decidir cuánta agenda se aprovecha: con
   * servicios que no duran un múltiplo del paso, el hueco que queda detrás de
   * cada cita no se podía llenar.
   */
  describe('el final de una cita es un horario ofrecible', () => {
    // Una cita de 09:00 a 09:20 deja libre desde las 09:20, que no cae en
    // ninguna grilla: ni la de 30 ni la de 15.
    const cita = [{ startTime: at(9), endTime: at(9, 20) }];

    it('lo ofrece aunque no caiga en el paso', async () => {
      const slots = await buildService(cita).getAvailableSlots(query);

      expect(startsOf(slots)).toContain('09:20');
    });

    it('no ofrece los que se pisan con la cita', async () => {
      const slots = await buildService(cita).getAvailableSlots(query);

      expect(startsOf(slots)).not.toContain('09:00');
    });

    it('se puede confirmar, no sólo ver', async () => {
      const confirmation = await buildService(cita).confirmSlot({
        ...query,
        startTime: at(9, 20),
      });

      expect(confirmation.available).toBe(true);
    });

    it('sin citas no aparece ningún horario suelto', async () => {
      const slots = await buildService().getAvailableSlots(query);

      expect(startsOf(slots)).toEqual([
        '09:00',
        '09:30',
        '10:00',
        '10:30',
        '11:00',
        '11:30',
      ]);
    });
  });
});
