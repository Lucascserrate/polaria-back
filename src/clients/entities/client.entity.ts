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
import { Conversation } from '../../conversations/entities/conversation.entity';
import { Message } from '../../messages/entities/message.entity';

/**
 * Índice propio para la foreign key a `tenants`.
 *
 * Es redundante con el índice único de abajo, pero deliberado. MySQL exige que
 * toda FK tenga un índice que empiece por su columna y reutiliza uno existente
 * si le sirve: sin este, la FK se apoyaba en el índice único —que también
 * empieza por `tenantId`— y lo volvía imposible de soltar. Cualquier cambio a
 * `phone` obligaba a recrear ese índice y fallaba con "Cannot drop index:
 * needed in a foreign key constraint", dejando el `synchronize` en bucle.
 *
 * Con un índice dedicado, la FK se apoya en este y el otro queda libre. Mismo
 * problema que documenta `BookingSession`, resuelto allá invirtiendo el orden
 * de las columnas; acá no se puede invertir sin soltar el índice, que es
 * justamente lo que está bloqueado.
 */
@Index(['tenantId'])
/**
 * El índice único deduplica a los clientes que llegan por WhatsApp, donde el
 * teléfono es su identidad. Los cargados a mano en el panel pueden no tenerlo:
 * quedan con `NULL`, y MySQL admite múltiples `NULL` en un índice único, así que
 * conviven sin competir entre sí. Es el mismo recurso que usa
 * `appointment_services.activeStartTime`.
 */
@Index(['tenantId', 'phone'], { unique: true })
@Entity('clients')
export class Client {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.clients, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;

  /**
   * Obligatorio para los clientes de WhatsApp, opcional para los que el negocio
   * carga desde el panel. Nunca cadena vacía: dos vacías chocarían en el índice
   * único, así que `findOrCreateByPhone` la normaliza a `NULL`.
   */
  @Column({ type: 'varchar', nullable: true })
  phone?: string | null;

  @Column({ nullable: true })
  name?: string;

  @Column({ nullable: true })
  notes?: string;

  @OneToMany(() => Conversation, (conversation) => conversation.client)
  conversations!: Conversation[];

  @OneToMany(() => Message, (message) => message.client)
  messages!: Message[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
