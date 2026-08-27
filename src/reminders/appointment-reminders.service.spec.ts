import {
  AppointmentRemindersService,
  REMINDER_SEND_REASONS,
} from './appointment-reminders.service';
import type { AppointmentRemindersRepository } from './appointment-reminders.repository';
import type { TenantsService } from '../tenants/tenants.service';
import { REMINDER_REASONS, ReminderState } from './appointment-reminders.rules';
import {
  AppointmentStatus,
  type Appointment,
} from '../appointments/entities/appointment.entity';
import type { Tenant } from '../tenants/entities/tenant.entity';
import type { AppointmentReminder } from './entities/appointment-reminder.entity';

/*
 * Estas pruebas viven a nivel de servicio y no de reglas, y esa es la razón por la
 * que existen.
 *
 * `resolveReminderTarget` ya estaba bien y bien probada: devuelve
 * `LEAD_TIME_PASSED` cuando el momento de avisar pasó. Lo que fallaba era el
 * llamador, que le pasaba un `now` corrido hacia atrás y volvía esa rama
 * inalcanzable. Ninguna prueba de la capa pura podía detectarlo.
 */

const TENANT_ID = 'tenant-1';

/** 00:00 del 27 de agosto en La Paz (UTC-4). */
const NOW = new Date('2026-08-27T04:00:00.000Z');
/** 11:00 del 27 en La Paz: dentro de once horas. */
const APPOINTMENT_START = new Date('2026-08-27T15:00:00.000Z');

const ONE_DAY = 1440;
const ONE_HOUR = 60;

const tenant = (offsets: number[]): Tenant =>
  ({
    id: TENANT_ID,
    name: 'Studio Nova',
    timezone: 'America/La_Paz',
    reminderOffsets: offsets,
    reminderTemplateStatus: 'APPROVED',
  }) as unknown as Tenant;

const appointment = (overrides: Partial<Appointment> = {}): Appointment =>
  ({
    id: 'appt-1',
    tenantId: TENANT_ID,
    status: AppointmentStatus.CONFIRMED,
    startTime: APPOINTMENT_START,
    client: { phone: '+59170000000' },
    ...overrides,
  }) as unknown as Appointment;

type UpsertCall = {
  offsetMinutes: number;
  state: ReminderState;
  scheduledFor: Date | null;
  failureReason: string | null;
};

const buildService = (params: {
  appointments: Appointment[];
  offsets: number[];
  existing?: AppointmentReminder[];
}) => {
  const upserts: UpsertCall[] = [];

  const repository = {
    findAppointmentsToReconcile: () => Promise.resolve(params.appointments),
    findOrphanScheduled: () => Promise.resolve([]),
    findByAppointmentIds: () => Promise.resolve(params.existing ?? []),
    upsert: (call: UpsertCall) => {
      upserts.push(call);
      return Promise.resolve();
    },
    updateState: () => Promise.resolve(),
  } as unknown as AppointmentRemindersRepository;

  const tenants = {
    findOne: () => Promise.resolve(tenant(params.offsets)),
  } as unknown as TenantsService;

  return {
    service: new AppointmentRemindersService(repository, tenants),
    upserts,
  };
};

describe('reconcile', () => {
  /*
   * El caso reportado. Con el aviso de 24 horas y el de 1 configurados, una cita
   * agendada para dentro de once horas solo puede tener el de 1: el instante del
   * de 24 —las 11:00 del día anterior— ya ocurrió.
   *
   * Antes, el de 24 se guardaba como `SCHEDULED` con un `scheduledFor` en el
   * pasado, y el barrido siguiente lo tomaba por vencido y lo enviaba.
   */
  it('no programa una anticipación cuyo momento ya pasó', async () => {
    const { service, upserts } = buildService({
      appointments: [appointment()],
      offsets: [ONE_DAY, ONE_HOUR],
    });

    await service.reconcile(NOW);

    const dayAhead = upserts.find((call) => call.offsetMinutes === ONE_DAY);

    expect(dayAhead).toEqual({
      appointmentId: 'appt-1',
      tenantId: TENANT_ID,
      channel: 'whatsapp',
      offsetMinutes: ONE_DAY,
      state: ReminderState.SKIPPED,
      scheduledFor: null,
      failureReason: REMINDER_REASONS.LEAD_TIME_PASSED,
    });
  });

  it('y sí programa la que todavía no llegó', async () => {
    const { service, upserts } = buildService({
      appointments: [appointment()],
      offsets: [ONE_DAY, ONE_HOUR],
    });

    await service.reconcile(NOW);

    const hourAhead = upserts.find((call) => call.offsetMinutes === ONE_HOUR);

    expect(hourAhead?.state).toBe(ReminderState.SCHEDULED);
    // 10:00 en La Paz, una hora antes de la cita.
    expect(hourAhead?.scheduledFor?.toISOString()).toBe(
      '2026-08-27T14:00:00.000Z',
    );
  });

  /*
   * La propiedad que faltaba: nada que se programe puede quedar en el pasado. Es
   * la forma general del bug —una fila con `scheduledFor` viejo y estado
   * `SCHEDULED` es, por construcción, un mensaje que va a salir de inmediato—.
   */
  it('nunca programa un aviso con el momento en el pasado', async () => {
    const { service, upserts } = buildService({
      appointments: [appointment()],
      offsets: [ONE_DAY, 720, 360, 180, ONE_HOUR],
    });

    await service.reconcile(NOW);

    const scheduled = upserts.filter(
      (call) => call.state === ReminderState.SCHEDULED,
    );

    expect(scheduled.length).toBeGreaterThan(0);
    for (const call of scheduled) {
      expect(call.scheduledFor!.getTime()).toBeGreaterThan(NOW.getTime());
    }
  });
});

describe('validateBeforeSending', () => {
  const service = buildService({ appointments: [], offsets: [] }).service;

  const reminder = (overrides: {
    startTime?: Date;
    status?: AppointmentStatus;
    offsetMinutes?: number;
    scheduledFor?: Date | null;
  }): AppointmentReminder =>
    ({
      id: 'reminder-1',
      offsetMinutes: overrides.offsetMinutes ?? ONE_HOUR,
      scheduledFor:
        overrides.scheduledFor === undefined
          ? new Date('2026-08-27T14:00:00.000Z')
          : overrides.scheduledFor,
      appointment: appointment({
        startTime: overrides.startTime ?? APPOINTMENT_START,
        status: overrides.status ?? AppointmentStatus.CONFIRMED,
      }),
      tenant: tenant([ONE_HOUR]),
    }) as unknown as AppointmentReminder;

  /*
   * Un aviso vencido está vencido por definición, así que su propio momento no
   * puede ser el motivo para no enviarlo. Este es el caso que justifica que la
   * revalidación se juzgue desde la hora programada y no desde ahora.
   */
  it('envía un aviso vencido cuya cita sigue en pie', () => {
    const now = new Date('2026-08-27T14:03:00.000Z');

    expect(
      service.validateBeforeSending({
        reminder: reminder({}),
        now,
        templateStatus: 'APPROVED',
      }),
    ).toBeNull();
  });

  /*
   * El hueco que abría lo anterior. Tras una caída del barrido, la fila queda
   * vencida y la cita puede haber ocurrido sin que nadie la marcara atendida: para
   * las reglas sigue activa y su horario coincide con el programado. Lo único
   * fuera de lugar es el reloj.
   */
  it('no envía el aviso de una cita que ya empezó', () => {
    const now = new Date('2026-08-27T17:00:00.000Z');

    expect(
      service.validateBeforeSending({
        reminder: reminder({}),
        now,
        templateStatus: 'APPROVED',
      }),
    ).toBe(REMINDER_SEND_REASONS.APPOINTMENT_ALREADY_STARTED);
  });

  it('no envía si la cita se movió de horario', () => {
    const now = new Date('2026-08-27T14:03:00.000Z');
    const moved = reminder({
      startTime: new Date('2026-08-27T18:00:00.000Z'),
    });

    expect(
      service.validateBeforeSending({
        reminder: moved,
        now,
        templateStatus: 'APPROVED',
      }),
    ).toBe(REMINDER_SEND_REASONS.APPOINTMENT_CHANGED);
  });

  it('no envía si la cita se canceló', () => {
    const now = new Date('2026-08-27T14:03:00.000Z');
    const cancelled = reminder({ status: AppointmentStatus.CANCELLED });

    expect(
      service.validateBeforeSending({
        reminder: cancelled,
        now,
        templateStatus: 'APPROVED',
      }),
    ).toBe(REMINDER_REASONS.APPOINTMENT_INACTIVE);
  });
});
