import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';

import {
  Appointment,
  BLOCKING_APPOINTMENT_STATUSES,
} from '../appointments/entities/appointment.entity';
import { AppointmentReminder } from './entities/appointment-reminder.entity';
import { ReminderState } from './appointment-reminders.rules';

/**
 * Acceso a datos de los recordatorios. No decide nada: las reglas viven en
 * `appointment-reminders.rules` y la orquestación en el servicio.
 */
@Injectable()
export class AppointmentRemindersRepository {
  constructor(
    @InjectRepository(AppointmentReminder)
    private readonly reminderRepository: Repository<AppointmentReminder>,
    @InjectRepository(Appointment)
    private readonly appointmentRepository: Repository<Appointment>,
  ) {}

  /**
   * Citas que podrían necesitar un recordatorio, con lo necesario para decidirlo.
   *
   * Mira hacia adelante desde ahora: una cita que ya empezó no tiene aviso
   * pendiente. El límite superior evita recorrer la agenda entera del año cuando
   * la anticipación máxima es de un día.
   */
  findAppointmentsToReconcile(params: {
    from: Date;
    until: Date;
  }): Promise<Appointment[]> {
    return this.appointmentRepository
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.client', 'client')
      .where('appointment.startTime > :from', { from: params.from })
      .andWhere('appointment.startTime <= :until', { until: params.until })
      .andWhere('appointment.status IN (:...statuses)', {
        statuses: BLOCKING_APPOINTMENT_STATUSES,
      })
      .getMany();
  }

  /**
   * Recordatorios de citas que dejaron de estar activas.
   *
   * Es la otra mitad de la reconciliación: la consulta de arriba solo ve citas
   * activas, así que una cancelada nunca aparecería y su recordatorio quedaría
   * programado para siempre.
   */
  findOrphanScheduled(): Promise<AppointmentReminder[]> {
    return this.reminderRepository
      .createQueryBuilder('reminder')
      .innerJoinAndSelect('reminder.appointment', 'appointment')
      .where('reminder.state = :state', { state: ReminderState.SCHEDULED })
      .andWhere('appointment.status NOT IN (:...statuses)', {
        statuses: BLOCKING_APPOINTMENT_STATUSES,
      })
      .getMany();
  }

  findByAppointmentIds(
    appointmentIds: string[],
    channel: string,
  ): Promise<AppointmentReminder[]> {
    if (appointmentIds.length === 0) return Promise.resolve([]);

    return this.reminderRepository
      .createQueryBuilder('reminder')
      .where('reminder.appointmentId IN (:...appointmentIds)', {
        appointmentIds,
      })
      .andWhere('reminder.channel = :channel', { channel })
      .getMany();
  }

  /**
   * Recordatorios vencidos, con todo lo que hace falta para redactar el mensaje
   * y para revalidar la cita antes de enviarlo.
   */
  findDue(params: {
    now: Date;
    channel: string;
  }): Promise<AppointmentReminder[]> {
    return this.reminderRepository.find({
      where: {
        state: ReminderState.SCHEDULED,
        channel: params.channel,
        scheduledFor: LessThanOrEqual(params.now),
      },
      relations: {
        tenant: true,
        appointment: {
          client: true,
          services: { service: true, staff: true },
        },
      },
      // El profesional puede haber sido dado de baja después de agendarse la
      // cita; el recordatorio tiene que seguir diciendo con quién es.
      withDeleted: true,
      order: { scheduledFor: 'ASC' },
    });
  }

  async upsert(params: {
    appointmentId: string;
    tenantId: string;
    channel: string;
    offsetMinutes: number;
    scheduledFor: Date | null;
    state: ReminderState;
    failureReason: string | null;
  }): Promise<void> {
    // `orUpdate` sobre la clave única: si dos reconciliaciones simultáneas
    // intentan crear la misma fila, la segunda actualiza en lugar de estallar
    // con un error de duplicado.
    await this.reminderRepository.upsert(params, {
      conflictPaths: ['appointmentId', 'channel', 'offsetMinutes'],
      skipUpdateIfNoValuesChanged: true,
    });
  }

  /**
   * Toma el recordatorio para enviarlo, si nadie lo tomó antes.
   *
   * Es el punto donde se resuelve la concurrencia: la condición
   * `state = SCHEDULED` va dentro del `UPDATE`, así que el ganador lo elige la
   * base con su lock de fila y no una comprobación previa en JavaScript.
   * Devuelve `true` solo al que la modificó.
   *
   * Deja la fila en `SENDING` y no en `SENT`: lo único que se sabe en este
   * punto es que este proceso se hizo cargo, no que el mensaje llegó.
   */
  async claimForSending(reminderId: string): Promise<boolean> {
    const result = await this.reminderRepository
      .createQueryBuilder()
      .update(AppointmentReminder)
      .set({ state: ReminderState.SENDING })
      .where('id = :id', { id: reminderId })
      .andWhere('state = :state', { state: ReminderState.SCHEDULED })
      .execute();

    return (result.affected ?? 0) === 1;
  }

  /** Confirma la entrega. Recién acá el recordatorio queda enviado. */
  async markSent(params: {
    reminderId: string;
    sentAt: Date;
    metaMessageId: string | null;
  }): Promise<void> {
    await this.reminderRepository.update(params.reminderId, {
      state: ReminderState.SENT,
      sentAt: params.sentAt,
      metaMessageId: params.metaMessageId,
      failureReason: null,
    });
  }

  /**
   * Cierra los envíos que quedaron colgados.
   *
   * Una fila en `SENDING` más allá del umbral significa que el proceso murió
   * entre tomarla y terminar de hablar con Meta. Pasan a `FAILED` y no vuelven a
   * `SCHEDULED`: no se sabe si el mensaje salió, y ante la duda es mejor un
   * recordatorio que no llegó y se ve como fallido que uno duplicado.
   */
  async failStaleSending(params: {
    olderThan: Date;
    reason: string;
  }): Promise<number> {
    const result = await this.reminderRepository
      .createQueryBuilder()
      .update(AppointmentReminder)
      .set({ state: ReminderState.FAILED, failureReason: params.reason })
      .where('state = :state', { state: ReminderState.SENDING })
      .andWhere('updatedAt <= :olderThan', { olderThan: params.olderThan })
      .execute();

    return result.affected ?? 0;
  }

  /** Cierra un envío que el canal rechazó. */
  async markFailed(reminderId: string, failureReason: string): Promise<void> {
    await this.reminderRepository.update(reminderId, {
      state: ReminderState.FAILED,
      sentAt: null,
      failureReason: failureReason.slice(0, 255),
    });
  }

  async updateState(params: {
    reminderId: string;
    state: ReminderState;
    scheduledFor: Date | null;
    failureReason: string | null;
  }): Promise<void> {
    await this.reminderRepository.update(params.reminderId, {
      state: params.state,
      scheduledFor: params.scheduledFor,
      failureReason: params.failureReason,
    });
  }
}
