import { Injectable, Logger } from '@nestjs/common';

import type { Appointment } from '../appointments/entities/appointment.entity';
import type { Tenant } from '../tenants/entities/tenant.entity';
import { TenantsService } from '../tenants/tenants.service';
import { canSendTemplate } from '../whatsapp/template-status';
import { AppointmentRemindersRepository } from './appointment-reminders.repository';
import type { AppointmentReminder } from './entities/appointment-reminder.entity';
import { normalizeReminderOffsets } from './reminder-offsets';
import {
  REMINDER_CHANNEL_WHATSAPP,
  REMINDER_REASONS,
  ReminderState,
  resolveReminderAction,
  resolveReminderTarget,
  type ReminderTarget,
} from './appointment-reminders.rules';

/** Misma clave que el índice único de la tabla. */
const reminderKey = (appointmentId: string, offsetMinutes: number) =>
  `${appointmentId}:${offsetMinutes}`;

/** Hasta cuándo mirar hacia adelante al reconciliar. */
const RECONCILE_HORIZON_MINUTES = 3 * 24 * 60;

/** Motivos de fallo propios del canal, no de las reglas. */
export const REMINDER_SEND_REASONS = {
  TEMPLATE_NOT_APPROVED: 'TEMPLATE_NOT_APPROVED',
  NO_WHATSAPP_CONNECTION: 'NO_WHATSAPP_CONNECTION',
  APPOINTMENT_CHANGED: 'APPOINTMENT_CHANGED',
  /** El negocio apagó los avisos automáticos por WhatsApp. */
  NOTIFICATIONS_DISABLED: 'NOTIFICATIONS_DISABLED',
  /**
   * La cita ya empezó.
   *
   * No lo cubre `APPOINTMENT_INACTIVE`: una cita que ocurrió pero que nadie marcó
   * como atendida sigue en `confirmed`, así que para las reglas sigue activa. Y
   * tampoco lo cubre la revalidación del momento, que en esta etapa está apagada a
   * propósito. Sin este control, una caída del barrido de unas horas se resuelve
   * avisando "tu cita es hoy a las 11:00" a la una de la tarde.
   */
  APPOINTMENT_ALREADY_STARTED: 'APPOINTMENT_ALREADY_STARTED',
  /** El proceso murió mientras hablaba con el canal. */
  SEND_INTERRUPTED: 'SEND_INTERRUPTED',
} as const;

/**
 * Cuánto puede tardar un envío antes de considerarse interrumpido.
 *
 * Holgado a propósito: el barrido corre cada 5 minutos y una llamada HTTP sin
 * timeout puede tardar. Cerrar demasiado pronto un envío que en realidad está
 * en curso sería marcar como fallido algo que sí llegó.
 */
export const SENDING_TIMEOUT_MINUTES = 15;

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

    /**
     * Lo guardado, indexado por cita **y** anticipación.
     *
     * Antes alcanzaba con la cita porque había un recordatorio por cita. Con
     * varios, la clave tiene que ser la misma que la del índice único de la
     * tabla, o el de 24 horas y el de 1 se pisarían entre sí.
     */
    const storedByKey = new Map(
      existing.map((reminder) => [
        reminderKey(reminder.appointmentId, reminder.offsetMinutes),
        reminder,
      ]),
    );

    for (const appointment of appointments) {
      const tenant = await this.loadTenant(appointment.tenantId, tenantCache);
      if (!tenant) continue;

      const offsets = normalizeReminderOffsets(tenant.reminderOffsets);

      for (const offsetMinutes of offsets) {
        const stored =
          storedByKey.get(reminderKey(appointment.id, offsetMinutes)) ?? null;
        const target = this.targetFor({
          appointment,
          offsetMinutes,
          now,
          asOf: 'now',
        });
        const action = resolveReminderAction(target, stored);

        if (action.kind === 'NOOP') continue;

        await this.repository.upsert({
          appointmentId: appointment.id,
          tenantId: appointment.tenantId,
          channel: REMINDER_CHANNEL_WHATSAPP,
          offsetMinutes,
          scheduledFor: action.scheduledFor,
          state: action.state,
          failureReason: action.failureReason,
        });
        updated += 1;
      }

      /*
       * Filas de anticipaciones que ya no están configuradas.
       *
       * El bucle de arriba solo mira lo que el negocio quiere hoy, así que no
       * puede enterarse de lo que dejó de querer. Sin esto, apagar el aviso de 1
       * hora dejaría los ya programados esperando su turno y saldrían igual.
       *
       * Cubre también apagar todos: con la lista vacía el bucle de arriba no
       * itera y este cancela lo que hubiera quedado.
       */
      for (const reminder of existing) {
        if (reminder.appointmentId !== appointment.id) continue;
        if (offsets.includes(reminder.offsetMinutes)) continue;
        if (reminder.state !== ReminderState.SCHEDULED) continue;

        await this.repository.updateState({
          reminderId: reminder.id,
          state: ReminderState.CANCELLED,
          scheduledFor: null,
          failureReason: REMINDER_REASONS.OFFSET_NOT_CONFIGURED,
        });
        updated += 1;
      }
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
    /** Estado de la plantilla de recordatorios de este negocio. */
    templateStatus: string | null;
    /** El interruptor de avisos automáticos del negocio. */
    notificationsEnabled: boolean;
  }): string | null {
    const { reminder, now } = params;
    const { appointment, tenant } = reminder;

    if (!appointment || !tenant) {
      return REMINDER_SEND_REASONS.APPOINTMENT_CHANGED;
    }

    /*
     * Un aviso de una cita que ya pasó no se manda.
     *
     * Va antes que todo lo demás porque ninguna otra comprobación lo atrapa: la
     * cita puede seguir en `confirmed` —nadie la marcó atendida— y su horario
     * puede coincidir exacto con el que se programó. Lo único fuera de lugar es el
     * reloj, y eso solo se nota mirándolo.
     */
    if (appointment.startTime <= now) {
      return REMINDER_SEND_REASONS.APPOINTMENT_ALREADY_STARTED;
    }

    // La anticipación sale de la fila y no de la configuración actual: si el
    // negocio cambió de opinión, esta fila ya fue cancelada por la
    // reconciliación. Leer la configuración acá descartaría un envío legítimo
    // por un cambio que todavía no se reconcilió.
    const target = this.targetFor({
      appointment,
      offsetMinutes: reminder.offsetMinutes,
      now,
      // Este aviso está vencido por definición, así que su momento no puede ser
      // el motivo para no enviarlo. Lo que se revalida es todo lo demás.
      asOf: 'scheduled',
    });

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

    /*
     * El estado de la plantilla ya no está en el tenant sino en
     * `whatsapp_templates`, así que lo resuelve el llamador y lo pasa: acá no hay
     * acceso a esa tabla y agregárselo convertiría una función de reglas en una
     * consulta.
     */
    /*
     * El mismo interruptor que gobierna los avisos al equipo también gobierna los
     * recordatorios al cliente: para el negocio es una sola decisión —"que Polaria
     * mande mensajes automáticos"— y partirla en dos controles sería pedirle que
     * mantenga sincronizadas dos cosas que él piensa como una.
     *
     * La anticipación de cada recordatorio sigue configurándose aparte: eso es
     * *cuándo* avisar, no *si* avisar.
     */
    if (!params.notificationsEnabled) {
      return REMINDER_SEND_REASONS.NOTIFICATIONS_DISABLED;
    }

    if (!canSendTemplate(params.templateStatus)) {
      return REMINDER_SEND_REASONS.TEMPLATE_NOT_APPROVED;
    }

    return null;
  }

  /**
   * El objetivo de un recordatorio, juzgado desde un momento explícito.
   *
   * `asOf` no es un detalle: las dos etapas preguntan lo mismo desde lugares
   * distintos del tiempo, y confundirlas fue un bug real.
   *
   * - `'now'` — al **reconciliar**. Se juzga desde ahora, así que una
   *   anticipación cuyo momento ya pasó devuelve `LEAD_TIME_PASSED` y la fila
   *   queda en `SKIPPED`. Es lo que corresponde: agendar una cita para dentro de
   *   diez horas con el aviso de 24 configurado no tiene aviso de 24, porque ese
   *   instante ya ocurrió.
   *
   * - `'scheduled'` — al **revalidar** un aviso vencido, justo antes de enviarlo.
   *   Ahí el momento ya pasó por definición —para eso está vencido— así que
   *   juzgarlo desde ahora lo descartaría siempre. Se pregunta "como si" fuera un
   *   instante antes de su hora programada, para que lo único que decida sean las
   *   otras condiciones: que la cita siga activa, en su horario y con teléfono.
   *
   * Antes esto era un solo camino que elegía el más temprano de los dos, y por eso
   * `LEAD_TIME_PASSED` era inalcanzable al reconciliar: cualquier anticipación
   * pasada se programaba con un `scheduledFor` viejo, y el barrido siguiente la
   * enviaba de inmediato.
   */
  private targetFor(params: {
    appointment: Appointment;
    offsetMinutes: number;
    now: Date;
    asOf: 'now' | 'scheduled';
  }): ReminderTarget {
    const { appointment, offsetMinutes, now, asOf } = params;

    const scheduledFor = new Date(
      appointment.startTime.getTime() - offsetMinutes * 60_000,
    );

    return resolveReminderTarget({
      appointment: {
        status: appointment.status,
        startTime: appointment.startTime,
        clientPhone: appointment.client?.phone ?? null,
      },
      offsetMinutes,
      now: asOf === 'scheduled' ? new Date(scheduledFor.getTime() - 1) : now,
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
