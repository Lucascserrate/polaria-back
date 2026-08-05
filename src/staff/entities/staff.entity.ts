import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  ManyToMany,
  OneToMany,
  CreateDateColumn,
  DeleteDateColumn,
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

  @Column({ nullable: true })
  email?: string;

  @Column({ nullable: true })
  calendarId?: string;

  /**
   * Disponibilidad temporal: un profesional inactivo no se ofrece en la agenda
   * pero sigue siendo parte del equipo. No confundir con `deletedAt`, que es la
   * baja definitiva.
   */
  @Column({ default: true })
  isActive!: boolean;

  /**
   * Comisión del profesional como porcentaje de lo que factura (0–100).
   *
   * Va acá y no por servicio porque el trato con el empleado es uno solo; una
   * tabla de comisiones por servicio duplicaría la misma tasa en cada fila.
   * `NULL` significa que el negocio todavía no configuró comisión, distinto de
   * `0` (trabaja sin comisión), y por eso el reporte omite el monto en vez de
   * informar Bs 0.
   *
   * La tasa se aplica siempre en su valor vigente: el reporte la expone como
   * comisión *estimada*. Si en el futuro hace falta liquidar con la tasa que
   * regía el día del servicio, el camino es replicar el patrón de
   * `priceAtBooking` con un `commissionRateAtBooking` en el segmento.
   */
  @Column('decimal', { precision: 5, scale: 2, nullable: true })
  commissionRate?: number | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt?: Date | null;
}
