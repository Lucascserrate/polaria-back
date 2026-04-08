import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Staff } from '../../staff/entities/staff.entity';
import { Client } from '../../clients/entities/client.entity';
import { AppointmentService } from './appointment_service.entity';

export enum AppointmentStatus {
  PENDING = 'pending',
  BOOKED = 'booked',
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
}
@Index(['staffId', 'startTime'])
@Index(['tenantId', 'startTime'])
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
  staffId!: string;
  @ManyToOne(() => Staff, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'staffId' })
  staff!: Staff;

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

  @Column({ default: false })
  reminderSent!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
