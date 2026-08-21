import { AppointmentStatus } from '../appointments/entities/appointment.entity';
import {
  REMINDER_REASONS,
  ReminderState,
  resolveReminderAction,
  resolveReminderTarget,
  type ReminderSnapshot,
  type StoredReminder,
} from './appointment-reminders.rules';

const NOW = new Date('2026-08-20T10:00:00.000Z');
/** Mañana a la misma hora: 24 horas de anticipación caen justo en `NOW`. */
const TOMORROW = new Date('2026-08-21T10:00:00.000Z');

const snapshot = (
  overrides: {
    status?: AppointmentStatus;
    startTime?: Date;
    clientPhone?: string | null;
    remindersEnabled?: boolean;
    reminderLeadMinutes?: number;
    now?: Date;
  } = {},
): ReminderSnapshot => ({
  appointment: {
    // `CONFIRMED` es el estado con el que se crean todas las citas reales.
    status: overrides.status ?? AppointmentStatus.CONFIRMED,
    startTime: overrides.startTime ?? new Date('2026-08-22T16:00:00.000Z'),
    clientPhone:
      overrides.clientPhone === undefined
        ? '+59170000000'
        : overrides.clientPhone,
  },
  tenant: {
    remindersEnabled: overrides.remindersEnabled ?? true,
    reminderLeadMinutes: overrides.reminderLeadMinutes ?? 1440,
  },
  now: overrides.now ?? NOW,
});

describe('resolveReminderTarget', () => {
  it('programa la anticipación configurada antes de la cita', () => {
    const target = resolveReminderTarget(
      snapshot({ startTime: new Date('2026-08-22T16:00:00.000Z') }),
    );

    expect(target).toEqual({
      kind: 'SCHEDULE',
      scheduledFor: new Date('2026-08-21T16:00:00.000Z'),
    });
  });

  it('no programa nada con los recordatorios apagados', () => {
    expect(
      resolveReminderTarget(snapshot({ remindersEnabled: false })),
    ).toEqual({
      kind: 'NOT_NEEDED',
      reason: REMINDER_REASONS.DISABLED,
    });
  });

  it('no programa nada para una cita cancelada ni para una atendida', () => {
    for (const status of [
      AppointmentStatus.CANCELLED,
      AppointmentStatus.COMPLETED,
    ]) {
      expect(resolveReminderTarget(snapshot({ status }))).toEqual({
        kind: 'NOT_NEEDED',
        reason: REMINDER_REASONS.APPOINTMENT_INACTIVE,
      });
    }
  });

  it('no genera un recordatorio atrasado cuando la cita se agenda con poca anticipación', () => {
    // Ahora 10:00, cita hoy 18:00, anticipación 24 h: el momento de avisar era
    // ayer. No se avisa "ahora mismo": la configuración decía 24 horas antes.
    const target = resolveReminderTarget(
      snapshot({ startTime: new Date('2026-08-20T18:00:00.000Z') }),
    );

    expect(target).toEqual({
      kind: 'SKIP',
      reason: REMINDER_REASONS.LEAD_TIME_PASSED,
    });
  });

  it('trata el instante exacto como pasado', () => {
    expect(resolveReminderTarget(snapshot({ startTime: TOMORROW }))).toEqual({
      kind: 'SKIP',
      reason: REMINDER_REASONS.LEAD_TIME_PASSED,
    });
  });

  it('salta la cita sin teléfono, con el motivo', () => {
    expect(resolveReminderTarget(snapshot({ clientPhone: null }))).toEqual({
      kind: 'SKIP',
      reason: REMINDER_REASONS.NO_CLIENT_PHONE,
    });
    expect(resolveReminderTarget(snapshot({ clientPhone: '   ' }))).toEqual({
      kind: 'SKIP',
      reason: REMINDER_REASONS.NO_CLIENT_PHONE,
    });
  });

  it('sin teléfono y fuera de tiempo, informa el tiempo', () => {
    // El motivo verdadero es el tiempo: con teléfono tampoco se habría enviado.
    const target = resolveReminderTarget(
      snapshot({
        clientPhone: null,
        startTime: new Date('2026-08-20T18:00:00.000Z'),
      }),
    );

    expect(target).toEqual({
      kind: 'SKIP',
      reason: REMINDER_REASONS.LEAD_TIME_PASSED,
    });
  });

  it('usa la misma noción de cita activa que la agenda', () => {
    // El recordatorio se apoya en `blocksAgenda`, el mismo predicado que decide
    // si la cita ocupa un horario. Que sean el mismo evita que la agenda diga
    // "ocupado" y el recordatorio diga "no hace falta avisar".
    for (const status of [
      AppointmentStatus.PENDING,
      AppointmentStatus.CONFIRMED,
    ]) {
      expect(resolveReminderTarget(snapshot({ status })).kind).toBe('SCHEDULE');
    }
  });

  it('respeta anticipaciones cortas', () => {
    const target = resolveReminderTarget(
      snapshot({
        reminderLeadMinutes: 60,
        startTime: new Date('2026-08-20T18:00:00.000Z'),
      }),
    );

    expect(target).toEqual({
      kind: 'SCHEDULE',
      scheduledFor: new Date('2026-08-20T17:00:00.000Z'),
    });
  });
});

describe('resolveReminderAction', () => {
  const scheduled = (at: string): StoredReminder => ({
    state: ReminderState.SCHEDULED,
    scheduledFor: new Date(at),
  });

  it('crea la fila cuando no hay ninguna', () => {
    const action = resolveReminderAction(
      { kind: 'SCHEDULE', scheduledFor: new Date('2026-08-21T16:00:00.000Z') },
      null,
    );

    expect(action).toEqual({
      kind: 'CREATE',
      state: ReminderState.SCHEDULED,
      scheduledFor: new Date('2026-08-21T16:00:00.000Z'),
      failureReason: null,
    });
  });

  it('no toca nada si lo guardado ya coincide', () => {
    expect(
      resolveReminderAction(
        {
          kind: 'SCHEDULE',
          scheduledFor: new Date('2026-08-21T16:00:00.000Z'),
        },
        scheduled('2026-08-21T16:00:00.000Z'),
      ),
    ).toEqual({ kind: 'NOOP' });
  });

  it('converge al nuevo horario cuando la cita se mueve', () => {
    const action = resolveReminderAction(
      { kind: 'SCHEDULE', scheduledFor: new Date('2026-08-23T11:00:00.000Z') },
      scheduled('2026-08-21T16:00:00.000Z'),
    );

    expect(action).toEqual({
      kind: 'UPDATE',
      state: ReminderState.SCHEDULED,
      scheduledFor: new Date('2026-08-23T11:00:00.000Z'),
      failureReason: null,
    });
  });

  it('cancela lo programado cuando la cita deja de estar activa', () => {
    const action = resolveReminderAction(
      { kind: 'NOT_NEEDED', reason: REMINDER_REASONS.APPOINTMENT_INACTIVE },
      scheduled('2026-08-21T16:00:00.000Z'),
    );

    expect(action).toEqual({
      kind: 'UPDATE',
      state: ReminderState.CANCELLED,
      scheduledFor: null,
      failureReason: REMINDER_REASONS.APPOINTMENT_INACTIVE,
    });
  });

  it('nunca reenvía un recordatorio ya enviado', () => {
    // Ni siquiera si la cita cambió de horario después: el cliente ya recibió
    // un mensaje, y un segundo con la misma anticipación es spam.
    const targets = [
      {
        kind: 'SCHEDULE' as const,
        scheduledFor: new Date('2026-08-23T11:00:00.000Z'),
      },
      {
        kind: 'NOT_NEEDED' as const,
        reason: REMINDER_REASONS.APPOINTMENT_INACTIVE,
      },
    ];

    for (const target of targets) {
      expect(
        resolveReminderAction(target, {
          state: ReminderState.SENT,
          scheduledFor: new Date('2026-08-21T16:00:00.000Z'),
        }),
      ).toEqual({ kind: 'NOOP' });
    }
  });

  it('no reintenta lo que falló', () => {
    expect(
      resolveReminderAction(
        {
          kind: 'SCHEDULE',
          scheduledFor: new Date('2026-08-23T11:00:00.000Z'),
        },
        { state: ReminderState.FAILED, scheduledFor: null },
      ),
    ).toEqual({ kind: 'NOOP' });
  });

  it('revive un salteado cuando la condición se resuelve', () => {
    // Caso concreto: se cargó el teléfono del cliente después de crear la cita.
    const action = resolveReminderAction(
      { kind: 'SCHEDULE', scheduledFor: new Date('2026-08-21T16:00:00.000Z') },
      { state: ReminderState.SKIPPED, scheduledFor: null },
    );

    expect(action).toEqual({
      kind: 'UPDATE',
      state: ReminderState.SCHEDULED,
      scheduledFor: new Date('2026-08-21T16:00:00.000Z'),
      failureReason: null,
    });
  });

  it('pasa a salteado lo programado que quedó fuera de tiempo', () => {
    // Reagendar la cita más cerca de ahora puede dejar el momento del aviso en
    // el pasado: no se manda tarde, se registra por qué no salió.
    const action = resolveReminderAction(
      { kind: 'SKIP', reason: REMINDER_REASONS.LEAD_TIME_PASSED },
      scheduled('2026-08-21T16:00:00.000Z'),
    );

    expect(action).toEqual({
      kind: 'UPDATE',
      state: ReminderState.SKIPPED,
      scheduledFor: null,
      failureReason: REMINDER_REASONS.LEAD_TIME_PASSED,
    });
  });

  it('no reescribe un salteado que sigue igual', () => {
    expect(
      resolveReminderAction(
        { kind: 'SKIP', reason: REMINDER_REASONS.NO_CLIENT_PHONE },
        { state: ReminderState.SKIPPED, scheduledFor: null },
      ),
    ).toEqual({ kind: 'NOOP' });
  });
});
