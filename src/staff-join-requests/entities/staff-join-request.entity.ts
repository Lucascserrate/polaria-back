import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

/**
 * En qué quedó un pedido de acceso.
 *
 * Los resueltos no se borran: son el único registro de que alguien pidió entrar
 * y de que alguien lo dejó —o no—. Y `status` entra en el índice único, así que
 * un rechazado puede volver a pedir el día que el negocio cambie de idea.
 */
export type JoinRequestStatus = 'pending' | 'approved' | 'rejected';

/**
 * Alguien que dice trabajar en un negocio y pide entrar a su Polaria.
 *
 * Tabla propia y no una ficha de `staff` en estado pendiente: aquello lo escribe
 * el negocio y contesta "quién trabaja acá", y esto lo escribe cualquiera con
 * una cuenta de Google. Mezclarlos haría que un pedido de un desconocido
 * apareciera como empleado hasta que alguien lo rechace.
 *
 * Aprobar crea la ficha de verdad y reusa `grantAccess`, que es quien ya sabe
 * rechazar un correo que pertenece a otra cuenta.
 */
@Index(['tenantId', 'status'])
@Index(['googleId', 'status'])
@Entity('staff_join_requests')
export class StaffJoinRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  tenantId!: string;
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;

  /**
   * La cuenta de Google que pidió.
   *
   * Es lo que autentica, y por eso se guarda además del correo: el correo sirve
   * para que el dueño reconozca a la persona y para `grantAccess`, pero se puede
   * escribir a mano. Esto no.
   */
  @Column({ type: 'varchar', length: 255 })
  googleId!: string;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  /** Como lo informó Google. `null` cuando no lo entregó. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  name!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: JoinRequestStatus;

  @CreateDateColumn()
  createdAt!: Date;

  /** Cuándo se aprobó o rechazó. `null` mientras sigue pendiente. */
  @Column({ type: 'datetime', nullable: true })
  resolvedAt!: Date | null;
}
