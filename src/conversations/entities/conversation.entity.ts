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

export enum ConversationState {
  IDLE = 'IDLE',
  ASK_SERVICE = 'ASK_SERVICE',
  ASK_STAFF = 'ASK_STAFF',
  SUGGEST_SLOTS = 'SUGGEST_SLOTS',
  ASK_SLOT = 'ASK_SLOT',
  CONFIRM_APPOINTMENT = 'CONFIRM_APPOINTMENT',
  BOOKING_COMPLETE = 'BOOKING_COMPLETE',
}

export interface ConversationContext {
  [key: string]: unknown;
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

  @OneToMany(() => Message, (message) => message.conversation)
  messages!: Message[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
