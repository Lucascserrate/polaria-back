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
   * `state = SCHEDULED` va dentro del `UPDATE`, así que la base decide quién
   * gana. Devuelve `true` solo al que modificó la fila; cualquier otra ejecución
   * recibe `false` y no envía nada.
   */
  async claimForSending(reminderId: string, now: Date): Promise<boolean> {
    const result = await this.reminderRepository
      .createQueryBuilder()
      .update(AppointmentReminder)
      .set({ state: ReminderState.SENT, sentAt: now })
      .where('id = :id', { id: reminderId })
      .andWhere('state = :state', { state: ReminderState.SCHEDULED })
      .execute();

    return (result.affected ?? 0) === 1;
  }

  async markMetaMessageId(
    reminderId: string,
    metaMessageId: string | null,
  ): Promise<void> {
    await this.reminderRepository.update(reminderId, { metaMessageId });
  }

  /** Devuelve al estado fallido un recordatorio que se había tomado para enviar. */
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
