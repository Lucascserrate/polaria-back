import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Client } from '../../clients/entities/client.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { BookingSessionState, StaffPreference } from '../booking-flow.types';

/**
 * Sesión de un flujo guiado de reserva.
 *
 * Es deliberadamente una tabla propia y no una bolsa dentro de
 * `conversations.contextJson`: el flujo necesita esquema explícito para
 * controlar caducidad, descartar interacciones obsoletas y garantizar
 * idempotencia. Cada dato seleccionado tiene su columna, y ninguno se infiere.
 */
/**
 * El orden de las columnas del índice es deliberado: `clientId` primero.
 *
 * MySQL exige que toda foreign key tenga un índice que empiece por su columna, y
 * reutiliza uno existente si le sirve. Con `tenantId` primero, este índice pasaba
 * a sostener la FK a `tenants` y **dejaba de poder soltarse**: cualquier cambio a
 * la tabla que obligara a recrearlo fallaba con "Cannot drop index: needed in a
 * foreign key constraint", y bastaba con agregar un valor al enum de estados para
 * romper la sincronización del esquema.
 *
 * Con `clientId` primero, MySQL crea su propio índice para la FK de `tenantId` y
 * este queda libre. Para la consulta da igual: `findActive` filtra por igualdad en
 * las dos columnas.
 *
 * Tampoco incluye `state`: `(clientId, tenantId)` ya deja un puñado de filas, y
 * filtrar el estado sobre eso es gratis.
 */
@Index(['clientId', 'tenantId'])
@Entity('booking_sessions')
export class BookingSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;

  @Column()
  clientId!: string;

  @ManyToOne(() => Client, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clientId' })
  client!: Client;

  /** Conversación asociada, para trazar el hilo completo. */
  @Column({ nullable: true })
  conversationId?: string;

  /**
   * Token corto y único que viaja dentro de cada `selectionId`. Permite atar una
   * respuesta interactiva a esta sesión y descartar las de sesiones ajenas.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  token!: string;

  @Column({
    type: 'enum',
    enum: BookingSessionState,
    default: BookingSessionState.ASK_SERVICE,
  })
  state!: BookingSessionState;

  /**
   * Se incrementa cada vez que se envía un componente. La respuesta trae la
   * versión con la que fue generada, así que una versión distinta a la actual
   * identifica una interacción vieja (por ejemplo, doble toque o una lista
   * enviada hace dos días) y se descarta.
   */
  @Column({ type: 'int', default: 0 })
  stepVersion!: number;

  // --- Datos seleccionados -------------------------------------------------

  /** Fecha elegida, `YYYY-MM-DD` en la zona horaria del negocio. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  selectedDate?: string | null;

  /** Exactamente un servicio por reserva. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  selectedServiceId?: string | null;

  @Column({ type: 'enum', enum: StaffPreference, nullable: true })
  staffPreference?: StaffPreference | null;

  /** Solo se completa cuando `staffPreference` es `SPECIFIC`. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  selectedStaffId?: string | null;

  /** Instante de inicio del horario elegido. */
  @Column({ type: 'datetime', nullable: true })
  selectedSlotStart?: Date | null;

  /**
   * Página actual de la lista del paso en curso, para canales que no pueden
   * mostrar todas las opciones de una vez.
   *
   * Es una sola columna para todos los pasos porque solo hay un componente vivo a
   * la vez. Se reinicia automáticamente al cambiar de paso.
   */
  @Column({ type: 'int', default: 0 })
  pageOffset!: number;

  // --- Control del flujo ---------------------------------------------------

  /**
   * Cita creada al confirmar. Su presencia hace idempotente la confirmación:
   * una sesión con `appointmentId` nunca vuelve a crear una reserva.
   */
  @Column({ type: 'varchar', length: 36, nullable: true })
  appointmentId?: string | null;

  /**
   * `id` del último mensaje de Meta procesado. Meta reintenta los webhooks, y
   * sin esta comprobación un reintento se leería como una segunda interacción.
   */
  @Column({ type: 'varchar', length: 128, nullable: true })
  lastMetaMessageId?: string | null;

  /** Momento a partir del cual la sesión se considera abandonada. */
  @Column({ type: 'datetime' })
  expiresAt!: Date;

  @Column({ type: 'datetime', nullable: true })
  lastInteractionAt?: Date | null;

  /** Motivo del cierre, para diagnóstico: cancelación explícita o caducidad. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  closedReason?: string | null;

  @Column({ type: 'datetime', nullable: true })
  closedAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
