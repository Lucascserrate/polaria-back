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
import { Tenant } from '../../tenants/entities/tenant.entity';
import { ReminderState } from '../appointment-reminders.rules';

/**
 * Un recordatorio programado para una cita.
 *
 * Existe como fila y no como cálculo al vuelo porque hace falta saber qué se
 * envió y qué no: sin registro, un reinicio o una consulta mal escrita pueden
 * mandar dos veces el mismo aviso, y no hay forma de auditar por qué un cliente
 * no recibió el suyo.
 *
 * La clave única es `(appointmentId, channel, offsetMinutes)`. Las tres columnas
 * y no solo la cita: es lo que permitirá varios recordatorios —uno de 24 horas y
 * otro de 1— y varios canales sin migrar la tabla ni tocar las reglas.
 */
@Index(['appointmentId', 'channel', 'offsetMinutes'], { unique: true })
/** El barrido busca lo vencido: estado + momento resuelven el filtro completo. */
@Index(['state', 'scheduledFor'])
@Entity('appointment_reminders')
export class AppointmentReminder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  appointmentId!: string;

  @ManyToOne(() => Appointment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'appointmentId' })
  appointment!: Appointment;

  /**
   * Se guarda además del que cuelga de la cita para poder barrer por negocio sin
   * unir tablas, y para que el recordatorio siga siendo atribuible si algún día
   * la cita se archiva.
   */
  @Column()
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;

  /** `whatsapp` hoy. Ver `REMINDER_CHANNEL_WHATSAPP`. */
  @Column({ type: 'varchar', length: 32 })
  channel!: string;

  /**
   * Anticipación con la que se programó, en minutos.
   *
   * Se copia de la configuración del negocio en lugar de leerla al enviar: si el
   * dueño la cambia, los recordatorios ya programados no tienen que mutar de
   * identidad, y la clave única sigue apuntando a la misma fila.
   */
  @Column({ type: 'int' })
  offsetMinutes!: number;

  /**
   * Cuándo hay que enviarlo. `NULL` en los estados que no esperan envío.
   *
   * Es un instante absoluto: `startTime` menos la anticipación. No hay
   * conversión de zona horaria porque no hace falta —restarle horas a un
   * instante da el mismo instante en cualquier zona—, y esa es exactamente la
   * cuenta que se quiere.
   */
  @Column({ type: 'datetime', nullable: true })
  scheduledFor!: Date | null;

  @Column({ type: 'varchar', length: 16, default: ReminderState.SCHEDULED })
  state!: ReminderState;

  @Column({ type: 'datetime', nullable: true })
  sentAt!: Date | null;

  /** Id que asignó Meta al mensaje. Permite rastrear la entrega. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  metaMessageId!: string | null;

  /**
   * Por qué no se envió. Se usa tanto para los saltos (`NO_CLIENT_PHONE`) como
   * para los fallos del canal, porque en los dos casos la pregunta del negocio
   * es la misma: por qué no llegó.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  failureReason!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
