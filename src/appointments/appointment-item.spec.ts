import { toAppointmentItem } from './appointment-item';
import {
  AppointmentStatus,
  type Appointment,
} from './entities/appointment.entity';
import { ReminderState } from '../reminders/reminder-state';

const TIMEZONE = 'America/La_Paz';

const segment = (overrides: {
  staffId?: string | null;
  staffName?: string | null;
  staffColor?: string | null;
  serviceName?: string | null;
  start: string;
  end: string;
  duration?: number;
}) =>
  ({
    staffId: overrides.staffId === undefined ? 'staff-1' : overrides.staffId,
    staff:
      overrides.staffName === null
        ? null
        : {
            name: overrides.staffName ?? 'Diego',
            calendarColor:
              overrides.staffColor === undefined
                ? 'coral'
                : overrides.staffColor,
          },
    service:
      overrides.serviceName === null
        ? null
        : { name: overrides.serviceName ?? 'Corte' },
    durationAtBooking: overrides.duration ?? 30,
    startTime: new Date(overrides.start),
    endTime: new Date(overrides.end),
  }) as unknown as Appointment['services'][number];

const appointment = (overrides: Partial<Appointment> = {}): Appointment =>
  ({
    id: 'appt-1',
    startTime: new Date('2026-08-22T13:00:00.000Z'),
    endTime: new Date('2026-08-22T13:30:00.000Z'),
    status: AppointmentStatus.CONFIRMED,
    client: { name: 'Ana' },
    tenant: { name: 'Studio Nova', timezone: TIMEZONE },
    reminders: [],
    services: [
      segment({
        start: '2026-08-22T13:00:00.000Z',
        end: '2026-08-22T13:30:00.000Z',
      }),
    ],
    ...overrides,
  }) as unknown as Appointment;

describe('toAppointmentItem', () => {
  it('lleva el color de cada profesional en su tramo', () => {
    const item = toAppointmentItem(
      appointment({
        services: [
          segment({
            staffColor: 'coral',
            start: '2026-08-22T13:00:00.000Z',
            end: '2026-08-22T13:30:00.000Z',
          }),
          segment({
            staffId: 'staff-2',
            staffName: 'Carlos',
            staffColor: 'teal',
            start: '2026-08-22T13:30:00.000Z',
            end: '2026-08-22T14:00:00.000Z',
          }),
        ],
      } as unknown as Partial<Appointment>),
      TIMEZONE,
    );

    // Por tramo y no por cita: una cita repartida entre dos personas no tiene un
    // color, tiene dos.
    expect(item.segments.map((s) => s.staffColor)).toEqual(['coral', 'teal']);
  });

  it('el color queda en null cuando el profesional no eligió ninguno', () => {
    const item = toAppointmentItem(
      appointment({
        services: [
          segment({
            staffColor: null,
            start: '2026-08-22T13:00:00.000Z',
            end: '2026-08-22T13:30:00.000Z',
          }),
        ],
      } as unknown as Partial<Appointment>),
      TIMEZONE,
    );

    expect(item.segments[0].staffColor).toBeNull();
  });

  it('un tramo sin profesional tampoco tiene color', () => {
    const item = toAppointmentItem(
      appointment({
        services: [
          segment({
            staffId: null,
            staffName: null,
            start: '2026-08-22T13:00:00.000Z',
            end: '2026-08-22T13:30:00.000Z',
          }),
        ],
      } as unknown as Partial<Appointment>),
      TIMEZONE,
    );

    expect(item.segments[0].staffColor).toBeNull();
  });

  it('devuelve los dos instantes de la cita', () => {
    // La agenda calcula el alto de la cita con estos dos y no con la duración,
    // que queda en 0 si algún servicio no la tiene cargada.
    const item = toAppointmentItem(appointment(), TIMEZONE);

    expect(item.startTime).toBe('2026-08-22T13:00:00.000Z');
    expect(item.endTime).toBe('2026-08-22T13:30:00.000Z');
  });

  it('formatea las horas en la zona del negocio', () => {
    const item = toAppointmentItem(appointment(), TIMEZONE);

    // 13:00 UTC son las 09:00 en Bolivia.
    expect(item.startTimeFormatted).toContain('09:00');
  });

  it('expone un tramo por servicio, ordenados por hora', () => {
    const item = toAppointmentItem(
      appointment({
        endTime: new Date('2026-08-22T14:00:00.000Z'),
        services: [
          segment({
            staffId: 'staff-2',
            staffName: 'Carlos',
            serviceName: 'Barba',
            start: '2026-08-22T13:30:00.000Z',
            end: '2026-08-22T14:00:00.000Z',
          }),
          segment({
            start: '2026-08-22T13:00:00.000Z',
            end: '2026-08-22T13:30:00.000Z',
          }),
        ],
      }),
      TIMEZONE,
    );

    // La vista por profesional ubica cada tramo en su columna: el orden importa
    // para leerla, y el de la base no está garantizado.
    expect(item.segments.map((s) => s.staffName)).toEqual(['Diego', 'Carlos']);
    expect(item.segments[1].startTime).toBe('2026-08-22T13:30:00.000Z');
    expect(item.segments[1].staffId).toBe('staff-2');
  });

  it('resume el profesional en "Varios" cuando la atienden dos', () => {
    const item = toAppointmentItem(
      appointment({
        services: [
          segment({
            start: '2026-08-22T13:00:00.000Z',
            end: '2026-08-22T13:30:00.000Z',
          }),
          segment({
            staffId: 'staff-2',
            staffName: 'Carlos',
            start: '2026-08-22T13:30:00.000Z',
            end: '2026-08-22T14:00:00.000Z',
          }),
        ],
      }),
      TIMEZONE,
    );

    expect(item.staffName).toBe('Varios');
    expect(item.segments).toHaveLength(2);
  });

  it('no repite el nombre cuando los dos servicios son de la misma persona', () => {
    const item = toAppointmentItem(
      appointment({
        services: [
          segment({
            start: '2026-08-22T13:00:00.000Z',
            end: '2026-08-22T13:30:00.000Z',
          }),
          segment({
            serviceName: 'Barba',
            start: '2026-08-22T13:30:00.000Z',
            end: '2026-08-22T14:00:00.000Z',
          }),
        ],
      }),
      TIMEZONE,
    );

    expect(item.staffName).toBe('Diego');
    expect(item.serviceNames).toEqual(['Corte', 'Barba']);
    expect(item.totalDuration).toBe(60);
  });

  it('sobrevive a una cita sin profesional ni servicio cargados', () => {
    const item = toAppointmentItem(
      appointment({
        services: [
          segment({
            staffId: null,
            staffName: null,
            serviceName: null,
            start: '2026-08-22T13:00:00.000Z',
            end: '2026-08-22T13:30:00.000Z',
          }),
        ],
      }),
      TIMEZONE,
    );

    expect(item.staffName).toBeUndefined();
    expect(item.serviceNames).toEqual([]);
    expect(item.segments[0].staffId).toBeNull();
  });

  it('muestra el próximo recordatorio pendiente', () => {
    const item = toAppointmentItem(
      appointment({
        reminders: [
          {
            state: ReminderState.SENT,
            scheduledFor: new Date('2026-08-21T13:00:00.000Z'),
            sentAt: new Date('2026-08-21T13:00:05.000Z'),
            failureReason: null,
          },
          {
            state: ReminderState.SCHEDULED,
            scheduledFor: new Date('2026-08-22T12:00:00.000Z'),
            sentAt: null,
            failureReason: null,
          },
        ] as unknown as Appointment['reminders'],
      }),
      TIMEZONE,
    );

    expect(item.reminder?.state).toBe(ReminderState.SCHEDULED);
    expect(item.reminder?.scheduledFor).toBe('2026-08-22T12:00:00.000Z');
  });
});
