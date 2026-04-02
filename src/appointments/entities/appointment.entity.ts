import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Staff } from '../../staff/entities/staff.entity';
import { Client } from '../../clients/entities/client.entity';
import { Service } from '../../services/entities/service.entity';
import { AppointmentService } from './AppointmentService';

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
  @ManyToOne(() => Tenant, (tenant) => tenant.id, { onDelete: 'CASCADE' })
  tenant!: Tenant;

  @Column()
  staffId!: string;
  @ManyToOne(() => Staff, (staff) => staff.id, { onDelete: 'CASCADE' })
  staff!: Staff;

  @Column()
  clientId!: string;
  @ManyToOne(() => Client, (client) => client.id, { onDelete: 'CASCADE' })
  client!: Client;

  @Column()
  serviceId!: string;

  @ManyToOne(() => Service, (service) => service.id, { onDelete: 'CASCADE' })
  service!: Service;

  @OneToMany(
    () => AppointmentService,
    (appointmentService) => appointmentService.appointment,
  )
  services!: AppointmentService[];

  @Column({ type: 'datetime' })
  startTime!: Date;

  @Column({ type: 'datetime' })
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
