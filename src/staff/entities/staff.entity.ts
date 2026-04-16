import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  ManyToMany,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
  JoinTable,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { AppointmentService } from '../../appointments/entities/appointment_service.entity';
import { Service } from '../../services/entities/service.entity';

@Entity('staff')
export class Staff {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.staff, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;

  @OneToMany(() => AppointmentService, (as) => as.staff)
  appointmentServices!: AppointmentService[];

  @ManyToMany(() => Service, (service) => service.staff, { cascade: false })
  @JoinTable({
    name: 'staff_services',
    joinColumn: { name: 'staffId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'serviceId', referencedColumnName: 'id' },
  })
  services!: Service[];

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
