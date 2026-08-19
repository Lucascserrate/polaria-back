import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { Staff } from '../../staff/entities/staff.entity';
import { Service } from '../../services/entities/service.entity';
import { Client } from '../../clients/entities/client.entity';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { Message } from '../../messages/entities/message.entity';
import { BusinessHour } from '../../business_hours/entities/business_hour.entity';

@Index(['whatsappPhoneNumber'], { unique: true })
@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ nullable: true })
  businessType?: string;

  /**
   * Número visible del negocio, tal como lo devuelve Meta.
   *
   * `NULL` significa que Polaria no tiene ninguna conexión activa: o nunca se
   * conectó, o el negocio desconectó desde el panel. Se libera al desconectar
   * porque el índice único lo convierte en un reclamo de exclusividad, y un
   * tenant desconectado que lo retuviera impediría para siempre que ese mismo
   * número se conectara en otra cuenta.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  whatsappPhoneNumber?: string | null;

  @Column({ type: 'text', nullable: true })
  whatsappPhoneId?: string;

  @Column({ type: 'text', nullable: true })
  whatsappAccessToken?: string;

  @Column({ type: 'text', nullable: true })
  whatsappBusinessId?: string;

  /**
   * Indexada y `varchar` en lugar de `text`: es lo único por lo que se puede
   * resolver el tenant de un webhook `account_update`, que no trae
   * `phone_number_id`. MySQL no indexa `TEXT` sin longitud de prefijo.
   */
  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  whatsappWabaId?: string | null;

  @Column({ type: 'text', nullable: true })
  whatsappVerifiedName?: string;

  /**
   * Id del Flow de reservas publicado en la WABA de este tenant.
   *
   * Es lo que decide por qué canal se reserva: con un Flow publicado se abre el
   * formulario; sin él, se usan las listas y botones nativos. Un Flow pertenece a
   * una WABA, así que cada barbería necesita el suyo y no se puede compartir.
   */
  @Column({ type: 'text', nullable: true })
  whatsappFlowId?: string;

  @Column({ type: 'timestamp', nullable: true })
  whatsappConnectedAt?: Date | null;

  /**
   * Desde cuándo Meta reporta la conexión como caída (`account_update`).
   *
   * Es un estado distinto de "sin conectar": las credenciales siguen guardadas a
   * propósito, porque estas caídas se revierten solas —un teléfono apagado unos
   * días— y `ACCOUNT_RECONNECTED` tiene que poder restaurarlas sin obligar al
   * negocio a rehacer el Embedded Signup. Si las borráramos, no habría con qué.
   */
  @Column({ type: 'datetime', nullable: true })
  whatsappUnavailableSince?: Date | null;

  /** Motivo que informó Meta: `CHANGE_NUMBER`, `PRIMARY_INACTIVITY`, etc. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  whatsappUnavailableReason?: string | null;

  /**
   * Coexistence: el número sigue usándose desde la app de WhatsApp Business
   * en paralelo a Cloud API. Cambia lo que se puede hacer con el número
   * (no se registra, throughput fijo, llegan echoes de la app).
   */
  @Column({ default: false })
  whatsappIsOnBusinessApp!: boolean;

  @Column({ type: 'text', nullable: true })
  whatsappPlatformType?: string;

  @Column()
  timezone!: string;

  /**
   * Moneda del negocio en ISO 4217 (`BOB`, `ARS`, `USD`…).
   *
   * Va acá y no en cada servicio porque es un dato del negocio: una barbería no
   * cobra un servicio en bolivianos y otro en dólares. Ponerlo por servicio
   * duplicaría el mismo valor en cada fila y abriría la puerta a que diverjan.
   */
  @Column({ type: 'varchar', length: 3, default: 'BOB' })
  currency!: string;

  @Column({ nullable: true })
  email?: string;

  @Column({ nullable: true })
  googleId?: string;

  @Column({ default: 'active' })
  status?: string;

  /**
   * Interruptor general de Polaria para todo el negocio.
   *
   * Es el plan de contingencia del negocio: si algo sale mal o decide que
   * Polaria no le sirve, tiene que poder callarla al instante y sin depender de
   * nadie. Por eso corta en el borde de entrada del webhook y no capa por capa.
   *
   * Es el equivalente para todo el negocio de `ConversationState.HUMAN_HANDOFF`,
   * que hace lo mismo en una sola conversación.
   */
  @Column({ default: true })
  aiEnabled!: boolean;

  @Column({ nullable: true })
  googleRefreshToken?: string;

  @Column({ nullable: true })
  googleAccessToken?: string;

  @Column({ nullable: true })
  calendarId?: string;

  @OneToMany(() => Staff, (staff) => staff.tenant)
  staff?: Staff[];

  @OneToMany(() => Service, (service) => service.tenant)
  services?: Service[];

  @OneToMany(() => Client, (client) => client.tenant)
  clients?: Client[];

  @OneToMany(() => Conversation, (conversation) => conversation.tenant)
  conversations?: Conversation[];

  @OneToMany(() => Message, (message) => message.tenant)
  messages?: Message[];

  @OneToMany(() => BusinessHour, (businessHour) => businessHour.tenant)
  businessHours?: BusinessHour[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
