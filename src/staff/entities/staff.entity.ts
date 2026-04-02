import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { AppointmentService } from '../../appointments/entities/AppointmentService';

@Entity('staff')
export class Staff {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.id, { onDelete: 'CASCADE' })
  tenant!: Tenant;

  @OneToMany(() => AppointmentService, (as) => as.staff)
  appointmentServices!: AppointmentService[];

  @Column()
  name!: string;

  @Column()
  email!: string;

  @Column({ nullable: true })
  calendarId?: string;

  @Column({ default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
