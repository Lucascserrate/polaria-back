import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Client } from '../../clients/entities/client.entity';

export enum ConversationState {
  IDLE = 'IDLE',
  ASK_SERVICE = 'ASK_SERVICE',
  ASK_STAFF = 'ASK_STAFF',
  SUGGEST_SLOTS = 'SUGGEST_SLOTS',
  ASK_SLOT = 'ASK_SLOT',
  CONFIRM_APPOINTMENT = 'CONFIRM_APPOINTMENT',
  BOOKING_COMPLETE = 'BOOKING_COMPLETE',
}

@Index(['tenantId', 'clientId'])
@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tenantId: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.id, { onDelete: 'CASCADE' })
  tenant: Tenant;

  @Column()
  clientId: string;

  @ManyToOne(() => Client, (client) => client.id, { onDelete: 'CASCADE' })
  client: Client;

  @Column({
    type: 'enum',
    enum: ConversationState,
    default: ConversationState.IDLE,
  })
  currentState: ConversationState;

  @Column({ type: 'json', nullable: true })
  contextJson?: any;

  @Column({ type: 'datetime', nullable: true })
  lastMessageAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
