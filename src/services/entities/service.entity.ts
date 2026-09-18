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
import { ServiceCategory } from '../../service-categories/entities/service-category.entity';

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

  /**
   * En qué grupo del catálogo cae, o `NULL` si en ninguno.
   *
   * `NULL` es un estado válido y permanente, no un dato a medio cargar: es lo
   * que tienen todos los servicios que existían antes de las categorías, y lo
   * que va a seguir teniendo el negocio de cinco servicios que no necesita
   * agruparlos. Se muestran juntos al final y se reservan igual.
   *
   * Borrar la categoría no borra el servicio: la foreign key es `SET NULL`, así
   * que vuelve a ese mismo grupo.
   */
  /*
   * El `type` explícito es obligatorio: de una unión `string | null` TypeORM
   * reflexiona `Object` y la app no arranca. Ver `entity-metadata.spec.ts`. El
   * largo es el del uuid al que apunta, no el `varchar(255)` de los demás `id`
   * del esquema: acá la columna nace con la tabla y puede ser exacta.
   */
  @Column({ type: 'varchar', length: 36, nullable: true })
  categoryId?: string | null;

  @ManyToOne(() => ServiceCategory, (category) => category.services, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'categoryId' })
  category?: ServiceCategory | null;

  @Column({ nullable: true })
  description?: string;

  /**
   * Cuánto cuesta, o `NULL` si se cotiza después de ver a la persona.
   *
   * `NULL` no es `0`: uno es "todavía no se sabe" y el otro es "no se cobra", y
   * el cliente los lee distinto. Ver `quoted-price.ts`.
   */
  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  price!: number | null;

  /**
   * Moneda de este precio, en ISO 4217.
   *
   * Va con el precio y no en el negocio porque un catálogo puede tener las dos
   * cosas: sesiones presenciales en bolivianos y online para el exterior en
   * dólares. `tenants.currency` quedó como el valor por defecto de un servicio
   * nuevo, no como la moneda de todos.
   *
   * Sin `NULL`: un precio sin unidad no se puede mostrar ni sumar. El servicio
   * que no elige nada nace con la del negocio, que se resuelve al crearlo.
   */
  @Column({ type: 'varchar', length: 3, default: 'BOB' })
  currency!: string;

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
