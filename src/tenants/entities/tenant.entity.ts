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
import { SubscriptionStatus } from '../../subscriptions/subscription.rules';

/**
 * Una cuenta de Google es un negocio. El índice único es lo que sostiene esa
 * regla cuando el registro es self-service: sin él, dos peticiones simultáneas
 * del primer login crearían dos negocios para la misma persona.
 *
 * Nulable a propósito: los tenants que crea soporte todavía no tienen cuenta
 * asociada, y MySQL admite varios NULL bajo un índice único.
 */
/**
 * Convierte a número lo que MySQL devuelve como cadena para las columnas
 * `decimal`. `null` se conserva: no tener ubicación no es la coordenada 0,0.
 */
const decimalTransformer = {
  to: (value?: number | null) => value ?? null,
  from: (value?: string | null) =>
    value === null || value === undefined ? null : Number(value),
};

@Index(['googleId'], { unique: true })
@Index(['whatsappPhoneNumber'], { unique: true })
@Index(['slug'], { unique: true })
@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  /**
   * Identificador del negocio en su página pública (`polariahq.com/royal-barber`).
   *
   * Único porque es una dirección: dos negocios con el mismo slug serían dos
   * negocios en la misma URL. Nulable porque un negocio recién registrado
   * todavía no tiene nombre propio —Google informa el de la persona— y un slug
   * derivado de ahí sería peor que ninguno.
   *
   * Se asigna una sola vez, cuando el negocio guarda su nombre real, y no
   * vuelve a cambiar aunque después se renombre: el slug es un enlace que ya
   * está pegado en un QR, en una biografía de Instagram y en las conversaciones
   * de los clientes. Ver `TenantsService.ensureSlug`.
   */
  @Column({ type: 'varchar', length: 60, nullable: true })
  slug!: string | null;

  @Column({ nullable: true })
  businessType?: string;

  /**
   * Dirección del local en texto, tal como la diría alguien que da indicaciones.
   *
   * Convive con `latitude`/`longitude` y no las reemplaza: son dos cosas
   * distintas. Las coordenadas sirven para mandar la ubicación por WhatsApp y
   * para abrir un mapa; esto es lo que se lee en la página pública, donde una
   * coordenada no le dice nada a nadie.
   *
   * `NULL` es normal: no todos los negocios reciben en un local con calle y
   * número, y la página tiene que verse bien sin esto.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  address!: string | null;

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
  whatsappPhoneNumber!: string | null;

  /**
   * Los campos de la conexión se declaran `!: T | null` y no `?: T`.
   *
   * No es cosmético: con el tipo opcional, borrarlos asignando `undefined`
   * compilaba, y TypeORM ignora las propiedades `undefined` al guardar —lo dice
   * en su propio código: "we don't perform operation over undefined properties
   * (but we DO need null properties!)"—. El resultado era una desconexión que el
   * panel mostraba como hecha mientras la columna conservaba el token, y Polaria
   * seguía respondiendo por WhatsApp. Con el tipo nulable obligatorio, borrar
   * con `undefined` no compila.
   */
  @Column({ type: 'text', nullable: true })
  whatsappPhoneId!: string | null;

  @Column({ type: 'text', nullable: true })
  whatsappAccessToken!: string | null;

  @Column({ type: 'text', nullable: true })
  whatsappBusinessId!: string | null;

  /**
   * Indexada y `varchar` en lugar de `text`: es lo único por lo que se puede
   * resolver el tenant de un webhook `account_update`, que no trae
   * `phone_number_id`. MySQL no indexa `TEXT` sin longitud de prefijo.
   */
  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  whatsappWabaId!: string | null;

  @Column({ type: 'text', nullable: true })
  whatsappVerifiedName!: string | null;

  /**
   * Id del Flow de reservas publicado en la WABA de este tenant.
   *
   * Es lo que decide por qué canal se reserva: con un Flow publicado se abre el
   * formulario; sin él, se usan las listas y botones nativos. Un Flow pertenece a
   * una WABA, así que cada barbería necesita el suyo y no se puede compartir.
   */
  @Column({ type: 'text', nullable: true })
  whatsappFlowId!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  whatsappConnectedAt!: Date | null;

  /**
   * Desde cuándo Meta reporta la conexión como caída (`account_update`).
   *
   * Es un estado distinto de "sin conectar": las credenciales siguen guardadas a
   * propósito, porque estas caídas se revierten solas —un teléfono apagado unos
   * días— y `ACCOUNT_RECONNECTED` tiene que poder restaurarlas sin obligar al
   * negocio a rehacer el Embedded Signup. Si las borráramos, no habría con qué.
   */
  @Column({ type: 'datetime', nullable: true })
  whatsappUnavailableSince!: Date | null;

  /** Motivo que informó Meta: `CHANGE_NUMBER`, `PRIMARY_INACTIVITY`, etc. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  whatsappUnavailableReason!: string | null;

  /**
   * Con cuánta anticipación se avisa cada cita, en minutos.
   *
   * Es una lista porque un negocio puede querer el aviso del día anterior **y**
   * el de un rato antes: son dos recordatorios de la misma cita, no un ajuste de
   * uno solo. Una lista vacía significa que están apagados, así que no hay un
   * booleano aparte que pueda contradecirla.
   *
   * En minutos y no en horas para no migrar el día que alguien quiera avisar 45
   * minutos antes. Se lee siempre con `normalizeReminderOffsets`: la columna es
   * JSON y su contenido no lo garantiza el esquema.
   */
  @Column({ type: 'json', nullable: true })
  reminderOffsets?: number[] | null;

  /**
   * Coexistence: el número sigue usándose desde la app de WhatsApp Business
   * en paralelo a Cloud API. Cambia lo que se puede hacer con el número
   * (no se registra, throughput fijo, llegan echoes de la app).
   */
  @Column({ default: false })
  whatsappIsOnBusinessApp!: boolean;

  @Column({ type: 'text', nullable: true })
  whatsappPlatformType!: string | null;

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
  /**
   * Coordenadas del local. Opcionales.
   *
   * Se guardan coordenadas y no una dirección de texto porque el destino es
   * enviar la ubicación **como ubicación** por WhatsApp, que es un tipo de
   * mensaje propio y pide latitud y longitud. Un enlace a un mapa obliga al
   * cliente a salir de la conversación.
   *
   * MySQL devuelve `decimal` como cadena, así que la columna lleva un
   * transformer: sin él, la propiedad sería `string` al leer y `number` al
   * escribir, y cada consumidor tendría que recordar convertirla. Es el problema
   * que `commissionRate` resolvió con helpers en el cliente; acá se corta en el
   * origen.
   */
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 7,
    nullable: true,
    transformer: decimalTransformer,
  })
  latitude?: number | null;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 7,
    nullable: true,
    transformer: decimalTransformer,
  })
  longitude?: number | null;

  /**
   * Estado de la suscripción tal como se guarda. Ver `SubscriptionStatus`.
   *
   * No confundir con el estado que se responde: `TRIAL` guardado puede ser una
   * prueba en curso o vencida según la hora, y esa cuenta la hace
   * `resolveSubscription`. Nace en `NONE` porque la prueba no empieza al
   * registrarse sino al conectar WhatsApp, que es cuando Polaria sirve de algo.
   */
  @Column({ type: 'varchar', length: 16, default: SubscriptionStatus.NONE })
  subscriptionStatus!: string;

  @Column({ type: 'datetime', nullable: true })
  trialStartedAt?: Date | null;

  /** Se calcula al arrancar la prueba y no se recalcula: ver `trialEndsAt()`. */
  @Column({ type: 'datetime', nullable: true })
  trialEndsAt?: Date | null;

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
