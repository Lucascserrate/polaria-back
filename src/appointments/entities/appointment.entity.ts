import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Client } from '../../clients/entities/client.entity';
import { AppointmentService } from './appointment_service.entity';
import { AppointmentReminder } from '../../reminders/entities/appointment-reminder.entity';

export enum AppointmentStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
}

/**
 * Estados en los que una cita ocupa la agenda.
 *
 * Fuente única para dos cosas que deben coincidir siempre: qué citas descarta el
 * cálculo de disponibilidad, y cuándo `appointment_services.activeStartTime` está
 * poblado para que el índice único bloquee duplicados. Si divergieran, el índice
 * rechazaría reservas que la disponibilidad considera libres.
 */
export const BLOCKING_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
];

export function blocksAgenda(status: AppointmentStatus): boolean {
  return BLOCKING_APPOINTMENT_STATUSES.includes(status);
}

/**
 * Estados en los que la cita sigue abierta: ya no se puede cambiar nada de ella
 * pero todavía no se resolvió en atendida ni en cancelada. Es lo que los
 * reportes cuentan como "pendiente".
 */
export const OPEN_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
];
@Index(['tenantId', 'startTime'])
/**
 * Los reportes filtran siempre por negocio + estado + rango de fechas. Con el
 * índice de arriba MySQL leería todas las citas del período para después
 * descartar por estado; con este resuelve el filtro completo desde el índice.
 */
@Index(['tenantId', 'status', 'startTime'])
@Entity('appointments')
export class Appointment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;

  @Column()
  clientId!: string;
  @ManyToOne(() => Client, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clientId' })
  client!: Client;

  @OneToMany(
    () => AppointmentService,
    (appointmentService) => appointmentService.appointment,
  )
  services!: AppointmentService[];

  @Column({ type: 'timestamp' })
  startTime!: Date;

  @Column({ type: 'timestamp' })
  endTime!: Date;

  @Column({
    type: 'enum',
    enum: AppointmentStatus,
    default: AppointmentStatus.PENDING,
  })
  status!: AppointmentStatus;

  @Column({ nullable: true })
  googleEventId?: string;

  /**
   * Recordatorios programados o enviados para esta cita.
   *
   * La relación existe para poder mostrar en la agenda si el aviso salió y,
   * si no, por qué. La decisión de qué recordar no vive acá.
   */
  @OneToMany(() => AppointmentReminder, (reminder) => reminder.appointment)
  reminders!: AppointmentReminder[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
