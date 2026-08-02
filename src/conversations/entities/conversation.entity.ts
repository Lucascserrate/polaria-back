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
import { Client } from '../../clients/entities/client.entity';
import { Message } from '../../messages/entities/message.entity';
export interface ConversationContext {
  [key: string]: unknown;
}

/**
 * Estado de la conversación libre.
 *
 * Los estados de reserva (`ASK_SERVICE`, `ASK_STAFF`, `SUGGEST_SLOTS`,
 * `CONFIRM_APPOINTMENT`, `BOOKING_COMPLETE`…) vivían acá cuando la IA conducía el
 * agendamiento. Ese recorrido ahora es una máquina explícita en
 * `booking_sessions`, con su propio estado, versión de paso y caducidad. La
 * conversación en sí no tiene fases: o hay una reserva en curso, o no la hay.
 */
export enum ConversationState {
  IDLE = 'IDLE',
  /**
   * El cliente pidió hablar con una persona. Polaria deja de responder por
   * completo en esta conversación, incluso a botones.
   *
   * Es el equivalente por conversación de `tenant.aiEnabled`, que apaga el
   * asistente para todo el negocio.
   */
  HUMAN_HANDOFF = 'HUMAN_HANDOFF',
}

@Index(['tenantId', 'clientId'])
@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.conversations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;

  @Column()
  clientId!: string;

  @ManyToOne(() => Client, (client) => client.conversations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'clientId' })
  client!: Client;

  @Column({
    type: 'enum',
    enum: ConversationState,
    default: ConversationState.IDLE,
  })
  currentState!: ConversationState;

  @Column({ type: 'json', nullable: true })
  contextJson?: ConversationContext;

  @Column({ type: 'timestamp', nullable: true })
  lastMessageAt?: Date;

  /**
   * Momento en que la conversación pasó a manos de una persona.
   *
   * Sirve para dos cosas: mostrar la antigüedad del pedido en el panel y
   * permitir que el barrido por inactividad devuelva la conversación a Polaria.
   */
  @Column({ type: 'datetime', nullable: true })
  handoffRequestedAt?: Date | null;

  /** Cómo se originó el traspaso. Hoy solo `CLIENT_REQUEST`. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  handoffReason?: string | null;

  @OneToMany(() => Message, (message) => message.conversation)
  messages!: Message[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
