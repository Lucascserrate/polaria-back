import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { AppointmentNotification } from './entities/appointment-notification.entity';
import { NotificationState } from './notification-state';

/** Hoy solo WhatsApp. Ver el comentario de `channel` en la entidad. */
export const NOTIFICATION_CHANNEL_WHATSAPP = 'whatsapp';

/**
 * Una fila a encolar: solo columnas, sin relaciones.
 *
 * Explícito y no `Partial<AppointmentNotification>` porque ese tipo incluye
 * `tenant`, `staff` y `appointment`, y el `insert` de TypeORM los rechaza —espera
 * ids, no entidades—. Nombrar las columnas también deja claro que encolar no toca
 * nada más.
 */
export interface NotificationRow {
  tenantId: string;
  appointmentId: string;
  staffId: string;
  event: string;
  fingerprint: string;
  serviceId: string;
  startTime: Date;
  previousStartTime: Date | null;
  channel: string;
  state: NotificationState;
  failureReason: string | null;
  sentAt: Date | null;
  metaMessageId: string | null;
}

/**
 * Acceso a datos de los avisos a profesionales. No decide nada: las reglas viven
 * en `staff-notification.rules` y la orquestación en el servicio.
 */
@Injectable()
export class StaffNotificationsRepository {
  constructor(
    @InjectRepository(AppointmentNotification)
    private readonly repository: Repository<AppointmentNotification>,
  ) {}

  /**
   * Encola un aviso, o no hace nada si ya estaba.
   *
   * Toda la idempotencia pasa por acá. `orIgnore` sobre la clave única significa
   * "si ya existe, no la toques": un reintento no puede revivir un aviso ya enviado
   * ni reescribir el motivo de uno salteado.
   *
   * Es la diferencia con el `upsert` de recordatorios, que sí actualiza. Ahí la fila
   * representa un **estado deseado** que se recalcula desde la cita; acá representa
   * un **hecho** que ocurrió una vez, y los hechos no se recalculan.
   */
  async enqueue(rows: NotificationRow[]): Promise<void> {
    if (rows.length === 0) return;

    await this.repository
      .createQueryBuilder()
      .insert()
      .into(AppointmentNotification)
      .values(rows)
      .orIgnore()
      .execute();
  }

  /**
   * Avisos listos para salir, con lo necesario para redactarlos.
   *
   * @param limit Techo por pasada. Un negocio que reagenda cincuenta citas de golpe
   * no debería producir un barrido que tarda minutos y bloquea al siguiente.
   */
  findPending(limit: number): Promise<AppointmentNotification[]> {
    return this.repository.find({
      where: {
        state: NotificationState.PENDING,
        channel: NOTIFICATION_CHANNEL_WHATSAPP,
      },
      relations: {
        tenant: true,
        staff: true,
        appointment: { client: true },
      },
      // El profesional puede haber sido dado de baja entre el encolado y el envío;
      // la fila tiene que poder leerse igual para explicar por qué no salió.
      withDeleted: true,
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  /** Los avisos ya enviados a alguien sobre una cita. Ver el borrado físico. */
  findSentFor(appointmentId: string): Promise<AppointmentNotification[]> {
    return this.repository.find({
      where: {
        appointmentId,
        state: In([NotificationState.SENT, NotificationState.SENDING]),
      },
    });
  }

  /**
   * Toma el aviso para enviarlo, si nadie lo tomó antes.
   *
   * La condición `state = PENDING` va dentro del `UPDATE`, así que el ganador lo
   * elige la base con su lock de fila y no una comprobación previa en JavaScript.
   * Es lo que permite que el envío inmediato y el barrido de red convivan sin
   * mandar el mensaje dos veces.
   */
  async claim(id: string): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(AppointmentNotification)
      .set({ state: NotificationState.SENDING })
      .where('id = :id', { id })
      .andWhere('state = :state', { state: NotificationState.PENDING })
      .execute();

    return (result.affected ?? 0) === 1;
  }

  async markSent(params: {
    id: string;
    sentAt: Date;
    metaMessageId: string | null;
  }): Promise<void> {
    await this.repository.update(params.id, {
      state: NotificationState.SENT,
      sentAt: params.sentAt,
      metaMessageId: params.metaMessageId,
      failureReason: null,
    });
  }

  async markFailed(id: string, failureReason: string): Promise<void> {
    await this.repository.update(id, {
      state: NotificationState.FAILED,
      failureReason: failureReason.slice(0, 64),
    });
  }

  async markSkipped(id: string, reason: string): Promise<void> {
    await this.repository.update(id, {
      state: NotificationState.SKIPPED,
      failureReason: reason,
    });
  }

  /**
   * Cierra los envíos que quedaron colgados.
   *
   * Una fila en `SENDING` más allá del umbral significa que el proceso murió entre
   * tomarla y terminar de hablar con Meta. Pasan a `FAILED` y no vuelven a
   * `PENDING`: no se sabe si el mensaje salió, y ante la duda es mejor un aviso que
   * no llegó y se ve como fallido que uno duplicado.
   */
  async failStale(params: {
    olderThan: Date;
    reason: string;
  }): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .update(AppointmentNotification)
      .set({ state: NotificationState.FAILED, failureReason: params.reason })
      .where('state = :state', { state: NotificationState.SENDING })
      .andWhere('updatedAt <= :olderThan', { olderThan: params.olderThan })
      .execute();

    return result.affected ?? 0;
  }
}
