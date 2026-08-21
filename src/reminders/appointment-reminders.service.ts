import { Injectable, Logger } from '@nestjs/common';

import type { Appointment } from '../appointments/entities/appointment.entity';
import type { Tenant } from '../tenants/entities/tenant.entity';
import { TenantsService } from '../tenants/tenants.service';
import { canSendReminders } from '../whatsapp/reminder-template';
import { AppointmentRemindersRepository } from './appointment-reminders.repository';
import type { AppointmentReminder } from './entities/appointment-reminder.entity';
import {
  REMINDER_CHANNEL_WHATSAPP,
  REMINDER_REASONS,
  ReminderState,
  resolveReminderAction,
  resolveReminderTarget,
  type ReminderTarget,
} from './appointment-reminders.rules';

/** Hasta cuándo mirar hacia adelante al reconciliar. */
const RECONCILE_HORIZON_MINUTES = 3 * 24 * 60;

/** Motivos de fallo propios del canal, no de las reglas. */
export const REMINDER_SEND_REASONS = {
  TEMPLATE_NOT_APPROVED: 'TEMPLATE_NOT_APPROVED',
  NO_WHATSAPP_CONNECTION: 'NO_WHATSAPP_CONNECTION',
  APPOINTMENT_CHANGED: 'APPOINTMENT_CHANGED',
} as const;

/**
 * Estado que le corresponde a cada recordatorio.
 *
 * Es el único lugar que combina la cita, la configuración del negocio y lo que
 * está guardado. El planificador le pregunta y persiste lo que responda; no
 * decide nada por su cuenta.
 */
@Injectable()
export class AppointmentRemindersService {
  private readonly logger = new Logger(AppointmentRemindersService.name);

  constructor(
    private readonly repository: AppointmentRemindersRepository,
    private readonly tenantsService: TenantsService,
  ) {}

  /**
   * Alinea las filas con lo que corresponde según el estado actual de las citas.
   *
   * Es reconciliación y no reacción a cada escritura: se recalcula desde la cita
   * en vez de hookear los ocho métodos que la modifican. Un cambio de horario o
   * una cancelación convergen porque la respuesta cambia, sin que nadie tenga
   * que acordarse de invalidar nada.
   */
  async reconcile(now: Date): Promise<{ updated: number }> {
    const horizon = new Date(
      now.getTime() + RECONCILE_HORIZON_MINUTES * 60_000,
    );

    const appointments = await this.repository.findAppointmentsToReconcile({
      from: now,
      until: horizon,
    });

    const orphans = await this.repository.findOrphanScheduled();

    const tenantCache = new Map<string, Tenant | null>();
    let updated = 0;

    const existing = await this.repository.findByAppointmentIds(
      appointments.map((appointment) => appointment.id),
      REMINDER_CHANNEL_WHATSAPP,
    );
    const storedByAppointment = new Map(
      existing.map((reminder) => [reminder.appointmentId, reminder]),
    );

    for (const appointment of appointments) {
      const tenant = await this.loadTenant(appointment.tenantId, tenantCache);
      if (!tenant) continue;

      const stored = storedByAppointment.get(appointment.id) ?? null;
      const target = this.targetFor({ appointment, tenant, now });
      const action = resolveReminderAction(target, stored);

      if (action.kind === 'NOOP') continue;

      await this.repository.upsert({
        appointmentId: appointment.id,
        tenantId: appointment.tenantId,
        channel: REMINDER_CHANNEL_WHATSAPP,
        offsetMinutes: tenant.reminderLeadMinutes,
        scheduledFor: action.scheduledFor,
        state: action.state,
        failureReason: action.failureReason,
      });
      updated += 1;
    }

    // Las citas que dejaron de estar activas no aparecen en la consulta de
    // arriba, así que su recordatorio se cancela por separado.
    for (const reminder of orphans) {
      await this.repository.updateState({
        reminderId: reminder.id,
        state: ReminderState.CANCELLED,
        scheduledFor: null,
        failureReason: REMINDER_REASONS.APPOINTMENT_INACTIVE,
      });
      updated += 1;
    }

    return { updated };
  }

  /**
   * Revalida un recordatorio vencido justo antes de enviarlo.
   *
   * Entre programar y enviar pasan horas, y en ese rato la cita pudo cancelarse,
   * moverse o atenderse. Sin esta comprobación, el recordatorio del viernes se
   * enviaría igual aunque la cita ya sea del sábado, que es exactamente lo que
   * no puede pasar.
   *
   * Devuelve `null` si corresponde enviar; un motivo si no.
   */
  validateBeforeSending(params: {
    reminder: AppointmentReminder;
    now: Date;
  }): string | null {
    const { reminder, now } = params;
    const { appointment, tenant } = reminder;

    if (!appointment || !tenant) {
      return REMINDER_SEND_REASONS.APPOINTMENT_CHANGED;
    }

    const target = this.targetFor({ appointment, tenant, now });

    // Lo que corresponde ahora tiene que seguir siendo "avisar", y en el mismo
    // momento para el que se programó. Si la cita se movió, el momento cambia y
    // este recordatorio ya no es el que va.
    if (target.kind !== 'SCHEDULE' && target.kind !== 'SKIP') {
      return target.reason;
    }

    if (target.kind === 'SKIP') return target.reason;

    if (
      reminder.scheduledFor &&
      target.scheduledFor.getTime() !== reminder.scheduledFor.getTime()
    ) {
      return REMINDER_SEND_REASONS.APPOINTMENT_CHANGED;
    }

    if (!canSendReminders(tenant.reminderTemplateStatus)) {
      return REMINDER_SEND_REASONS.TEMPLATE_NOT_APPROVED;
    }

    return null;
  }

  /**
   * El objetivo, con una salvedad: al revalidar antes de enviar, el momento ya
   * pasó por definición, así que `LEAD_TIME_PASSED` no es motivo para no enviar.
   * Se resuelve pidiendo el objetivo "como si" fuera el momento programado.
   */
  private targetFor(params: {
    appointment: Appointment;
    tenant: Tenant;
    now: Date;
  }): ReminderTarget {
    const { appointment, tenant, now } = params;

    const scheduledFor = new Date(
      appointment.startTime.getTime() - tenant.reminderLeadMinutes * 60_000,
    );

    return resolveReminderTarget({
      appointment: {
        status: appointment.status,
        startTime: appointment.startTime,
        clientPhone: appointment.client?.phone ?? null,
      },
      tenant: {
        remindersEnabled: tenant.remindersEnabled,
        reminderLeadMinutes: tenant.reminderLeadMinutes,
      },
      // Se evalúa contra el momento programado o contra ahora, el que sea más
      // temprano: si no, un recordatorio vencido se descartaría por "tarde" en
      // el mismo instante en que corresponde enviarlo.
      now: scheduledFor < now ? new Date(scheduledFor.getTime() - 1) : now,
    });
  }

  private async loadTenant(
    tenantId: string,
    cache: Map<string, Tenant | null>,
  ): Promise<Tenant | null> {
    if (cache.has(tenantId)) return cache.get(tenantId) ?? null;

    const tenant = await this.tenantsService.findOne(tenantId);
    cache.set(tenantId, tenant);

    if (!tenant) {
      this.logger.warn(`Cita de un tenant inexistente (tenantId=${tenantId}).`);
    }

    return tenant;
  }
}
