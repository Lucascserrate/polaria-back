import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { readStoredCredential } from '../whatsapp/utils/stored-credential.util';
import { WhatsAppSenderService } from '../whatsapp/whatsapp-sender.service';
import { AppointmentRemindersRepository } from './appointment-reminders.repository';
import {
  AppointmentRemindersService,
  REMINDER_SEND_REASONS,
} from './appointment-reminders.service';
import {
  REMINDER_CHANNEL_WHATSAPP,
  ReminderState,
} from './appointment-reminders.rules';
import type { AppointmentReminder } from './entities/appointment-reminder.entity';
import { buildReminderMessage } from './reminder-message';

/**
 * Ejecuta la reconciliación y el envío. **No decide nada**: le pregunta al
 * servicio qué corresponde y al repositorio si puede tomar la fila.
 *
 * Las dos etapas van en la misma pasada y en ese orden, para que una cita
 * cancelada hace un minuto no reciba su recordatorio en la misma corrida.
 */
@Injectable()
export class AppointmentRemindersJob {
  private readonly logger = new Logger(AppointmentRemindersJob.name);

  constructor(
    private readonly repository: AppointmentRemindersRepository,
    private readonly remindersService: AppointmentRemindersService,
    private readonly whatsAppSenderService: WhatsAppSenderService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    const now = new Date();

    try {
      const { updated } = await this.remindersService.reconcile(now);
      if (updated > 0) {
        this.logger.log(`Recordatorios reconciliados: ${updated}.`);
      }
    } catch (error: unknown) {
      this.logger.error(
        `Fallo al reconciliar recordatorios: ${describeError(error)}`,
      );
    }

    try {
      await this.sendDue(now);
    } catch (error: unknown) {
      this.logger.error(
        `Fallo al enviar recordatorios: ${describeError(error)}`,
      );
    }
  }

  private async sendDue(now: Date): Promise<void> {
    const due = await this.repository.findDue({
      now,
      channel: REMINDER_CHANNEL_WHATSAPP,
    });

    for (const reminder of due) {
      // Se revalida antes de tomar la fila: si la cita cambió, no hace falta
      // reservarla para nadie, solo corregir su estado.
      const blocked = this.remindersService.validateBeforeSending({
        reminder,
        now,
      });

      if (blocked) {
        // La plantilla sin aprobar es transitoria: se deja programado para
        // reintentar cuando Meta la apruebe. Cualquier otro motivo no vuelve.
        const isTransient =
          blocked === REMINDER_SEND_REASONS.TEMPLATE_NOT_APPROVED;

        await this.repository.updateState({
          reminderId: reminder.id,
          state: isTransient
            ? ReminderState.SCHEDULED
            : ReminderState.CANCELLED,
          scheduledFor: isTransient ? reminder.scheduledFor : null,
          failureReason: blocked,
        });
        continue;
      }

      await this.send(reminder, now);
    }
  }

  private async send(reminder: AppointmentReminder, now: Date): Promise<void> {
    const { appointment, tenant } = reminder;

    const accessToken = readStoredCredential(tenant.whatsappAccessToken);
    const phoneNumberId = readStoredCredential(tenant.whatsappPhoneId);
    const to = appointment.client?.phone;

    if (!accessToken || !phoneNumberId || !to) {
      await this.repository.updateState({
        reminderId: reminder.id,
        state: ReminderState.CANCELLED,
        scheduledFor: null,
        failureReason: REMINDER_SEND_REASONS.NO_WHATSAPP_CONNECTION,
      });
      return;
    }

    /*
     * Se toma la fila **antes** de llamar a Meta, no después.
     *
     * La condición `state = SCHEDULED` viaja dentro del UPDATE, así que si dos
     * ejecuciones coinciden solo una modifica la fila y solo esa envía. Al revés
     * —enviar y después marcar— las dos habrían enviado antes de escribir nada,
     * y el cliente recibiría el aviso dos veces.
     */
    const claimed = await this.repository.claimForSending(reminder.id, now);
    if (!claimed) {
      this.logger.log(
        `Recordatorio ya tomado por otra ejecución (reminderId=${reminder.id}).`,
      );
      return;
    }

    const segment = appointment.services?.[0];
    const message = buildReminderMessage({
      appointmentId: appointment.id,
      clientName: appointment.client?.name ?? null,
      businessName: tenant.name,
      serviceName: segment?.service?.name ?? null,
      professionalName: segment?.staff?.name ?? null,
      startTime: appointment.startTime,
      timezone: tenant.timezone,
    });

    const result = await this.whatsAppSenderService.sendTemplate(
      { accessToken, phoneNumberId },
      {
        to,
        name: tenant.reminderTemplateName ?? '',
        languageCode: tenant.reminderTemplateLanguage ?? 'es',
        bodyParameters: message.bodyParameters,
        quickReplyPayloads: message.quickReplyPayloads,
      },
    );

    if (!result.ok) {
      // La fila había quedado tomada como enviada y no lo fue.
      await this.repository.markFailed(
        reminder.id,
        result.error ?? 'SEND_FAILED',
      );
      this.logger.error(
        `Recordatorio no entregado (reminderId=${reminder.id}, tenantId=${tenant.id}): ${String(result.error)}`,
      );
      return;
    }

    await this.repository.markMetaMessageId(
      reminder.id,
      result.metaMessageId ?? null,
    );
    this.logger.log(
      `Recordatorio enviado (reminderId=${reminder.id}, appointmentId=${appointment.id}).`,
    );
  }
}

function describeError(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}
