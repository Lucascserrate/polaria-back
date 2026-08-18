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
import { StaffSchedule } from './staff_schedule.entity';

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

  /** Jornada propia. Solo se lee si `usesCustomSchedule` está encendido. */
  @OneToMany(() => StaffSchedule, (schedule) => schedule.staff)
  schedules!: StaffSchedule[];

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

  /**
   * WhatsApp del profesional, en formato internacional (`+59170000000`).
   *
   * Es el destinatario del aviso cuando un cliente le agenda una cita, así que
   * se guarda ya normalizado —solo `+` y dígitos— para poder pasarlo a la API
   * de Meta sin volver a limpiarlo en cada envío.
   *
   * `NULL` significa que el profesional no recibe avisos, y es el estado por
   * defecto: el negocio puede tener cargado a alguien que no usa WhatsApp. Por
   * eso nunca se guarda cadena vacía, que sería un destinatario roto disfrazado
   * de número configurado.
   */
  @Column({ type: 'varchar', nullable: true })
  phone?: string | null;

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
   * Apagado (por defecto): el profesional atiende en el horario del negocio y
   * sus filas de `staff_schedules` se ignoran.
   *
   * Encendido: `staff_schedules` es la verdad completa de su jornada, y **la
   * ausencia de fila para un día significa que ese día no trabaja**. El flag
   * existe justamente para que eso sea una declaración explícita del negocio y
   * no una inferencia a partir de una tabla vacía, que no permitiría distinguir
   * "no trabaja el jueves" de "todavía no cargué el jueves".
   */
  @Column({ default: false })
  usesCustomSchedule!: boolean;

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
