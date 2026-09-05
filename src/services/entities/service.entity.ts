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
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { AppointmentService } from '../../appointments/entities/appointment_service.entity';
import { Staff } from '../../staff/entities/staff.entity';

@Entity('services')
export class Service {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.services, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;

  @Column()
  name!: string;

  @Column({ nullable: true })
  description?: string;

  @Column('decimal', { precision: 10, scale: 2 })
  price!: number;

  @Column()
  timezone!: string;

  @Column('int')
  durationMinutes!: number;

  @Column({ default: true })
  isActive!: boolean;

  /**
   * Quién puede poner este servicio en la agenda. Ver `ServiceBookingPolicy`.
   *
   * `varchar` y no `enum` de MySQL: agregar una política nueva sería un `ALTER
   * TABLE` sobre una tabla que crece con cada negocio, y el valor lo valida el DTO
   * antes de llegar acá.
   *
   * Distinto de `isActive`, que es la baja: un servicio con consulta previa sigue
   * en el catálogo, se cotiza y el asistente lo explica. Lo único que no puede es
   * elegirlo el cliente.
   */
  @Column({ type: 'varchar', length: 24, default: 'CLIENT_BOOKS' })
  bookingPolicy!: string;

  @OneToMany(() => AppointmentService, (as) => as.service)
  appointmentServices!: AppointmentService[];

  @ManyToMany(() => Staff, (staff) => staff.services)
  staff!: Staff[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
