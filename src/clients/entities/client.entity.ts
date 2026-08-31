import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { Message } from '../../messages/entities/message.entity';

/**
 * Por qué puerta entró el cliente.
 *
 * Se guarda en el momento del alta porque después no se puede reconstruir: un
 * cliente con teléfono y sin conversación pudo llegar por la página pública o
 * haberlo cargado el negocio a mano, y nada en la base distingue los dos casos.
 * Es el dato que responde "¿cuántos clientes me trajo el WhatsApp?", que es una
 * pregunta que el negocio hace y hoy no tiene con qué contestar.
 */
export enum ClientSource {
  WHATSAPP = 'whatsapp',
  /** La página pública de reservas del negocio. */
  WEB = 'web',
  /** Lo cargó el negocio desde el panel. */
  PANEL = 'panel',
}

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
   * La identidad del cliente dentro del negocio. Ningún camino lo deja vacío hoy:
   * los tres canales pasan por `resolveByPhone`, que exige un teléfono utilizable.
   *
   * La columna sigue admitiendo `NULL` por los clientes que quedaron de cuando la
   * agenda los creaba escribiendo sólo un nombre. Se los reconoce en la lista por
   * el aviso "Sin teléfono", y se arreglan editándolos: mientras no tengan uno, no
   * hay forma de saber que son la misma persona que escribe por WhatsApp.
   */
  @Column({ type: 'varchar', nullable: true })
  phone?: string | null;

  @Column({ nullable: true })
  name?: string;

  @Column({ type: 'varchar', nullable: true })
  email?: string | null;

  /**
   * Sólo el día, sin hora ni zona: un cumpleaños no es un instante.
   *
   * Es `date` de SQL y por eso el driver lo entrega como `'YYYY-MM-DD'` y no
   * como `Date`. Guardarlo con hora lo correría un día para cualquier negocio al
   * oeste de UTC cada vez que se leyera, que es el error clásico de esta columna.
   */
  @Column({ type: 'date', nullable: true })
  birthDate?: string | null;

  /**
   * `NULL` en los clientes anteriores a que se registrara el canal.
   *
   * Se prefiere el `NULL` a inventarles una puerta de entrada: un valor supuesto
   * haría mentir a la única métrica que esta columna existe para responder.
   */
  @Column({ type: 'enum', enum: ClientSource, nullable: true })
  createdVia?: ClientSource | null;

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

  /**
   * Baja lógica del cliente que tiene historial.
   *
   * Es el único estado de baja que tiene un cliente, a diferencia de `Staff`, que
   * además usa `isActive` para el profesional que sigue en el equipo pero no se
   * ofrece en la agenda. Un cliente no se ofrece en ningún lado, así que ese
   * estado intermedio no existe y un segundo flag sólo podría desincronizarse.
   *
   * No sobrevive a una reserva nueva: si la persona vuelve a escribir,
   * `resolveByPhone` la restaura en lugar de duplicarla. La fila dada de baja
   * sigue ocupando su lugar en el índice único `(tenantId, phone)`, así que
   * insertar una segunda con el mismo teléfono fallaría de todos modos.
   */
  @DeleteDateColumn()
  deletedAt?: Date | null;
}
