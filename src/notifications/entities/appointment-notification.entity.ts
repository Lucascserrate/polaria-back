import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Appointment } from '../../appointments/entities/appointment.entity';
import { Staff } from '../../staff/entities/staff.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { NotificationState } from '../notification-state';

/**
 * Un aviso a un profesional de que una cita suya cambió.
 *
 * Existe como fila y no como llamada directa a WhatsApp por tres motivos, y cada
 * uno resuelve un punto del pedido:
 *
 * 1. **Idempotencia.** La clave única impide que la misma acción mande dos
 *    mensajes. Los seis lugares que modifican una cita —el panel, el flujo
 *    conversacional, el Flow, la cancelación por WhatsApp— pueden reintentarse, y
 *    un webhook de Meta puede llegar dos veces.
 * 2. **La cita nunca se cae por WhatsApp.** Escribir una fila no es hablar con
 *    Meta: el envío ocurre después y su fallo no puede deshacer la reserva.
 * 3. **Observabilidad.** El estado más el motivo responden si el aviso se pidió, si
 *    salió, si falló, o por qué no correspondía, sin construir analytics aparte.
 *
 * La clave única es `(appointmentId, staffId, event, fingerprint)`. El
 * `fingerprint` es lo que la hace funcionar: sin él, una segunda reprogramación
 * real quedaría silenciada por la primera. Ver `notificationFingerprint`.
 */
@Index(['appointmentId', 'staffId', 'event', 'fingerprint'], { unique: true })
/** El despachador busca lo pendiente; sin esto barre la tabla entera. */
@Index(['state', 'createdAt'])
@Entity('appointment_notifications')
export class AppointmentNotification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;

  @Column()
  appointmentId!: string;

  @ManyToOne(() => Appointment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'appointmentId' })
  appointment!: Appointment;

  @Column()
  staffId!: string;

  @ManyToOne(() => Staff, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'staffId' })
  staff!: Staff;

  /** `StaffAlertEvent`: qué le pasó a la cita. */
  @Column({ type: 'varchar', length: 16 })
  event!: string;

  /**
   * Huella de lo que se avisó: el instante del tramo y su servicio.
   *
   * Parte de la clave única. Ver `notificationFingerprint` para por qué.
   */
  @Column({ type: 'varchar', length: 128 })
  fingerprint!: string;

  /**
   * Servicio del tramo que se avisa.
   *
   * Se guarda además de estar en la huella porque el mensaje lo nombra, y para
   * redactarlo hace falta el id y no el texto de la huella. Sin FK: si el negocio
   * borra el servicio, el aviso que ya salió sigue siendo cierto.
   */
  @Column({ type: 'char', length: 36 })
  serviceId!: string;

  /** Instante del tramo avisado. */
  @Column({ type: 'timestamp' })
  startTime!: Date;

  /** Instante anterior, en una reprogramación. `NULL` en los otros eventos. */
  @Column({ type: 'timestamp', nullable: true })
  previousStartTime!: Date | null;

  /**
   * Canal de entrega. Hoy solo WhatsApp.
   *
   * Va en la fila y no en la clave única a propósito: si mañana el mismo aviso sale
   * también por correo, eso es otra fila con otro canal, y la clave tendría que
   * incluirlo. Cuando pase, se agrega a la clave en una migración; ponerlo ahora
   * sería una columna que solo tiene un valor.
   */
  @Column({ type: 'varchar', length: 16 })
  channel!: string;

  @Column({ type: 'varchar', length: 16 })
  state!: NotificationState;

  /** Por qué no salió. Ver `STAFF_NOTIFICATION_REASONS`. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  failureReason!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  sentAt!: Date | null;

  /** `id` del mensaje que asignó Meta. Permite rastrearlo de su lado. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  metaMessageId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
