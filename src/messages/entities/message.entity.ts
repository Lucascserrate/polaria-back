import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { Client } from '../../clients/entities/client.entity';

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}

@Index(['conversationId', 'createdAt'])
@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.id, { onDelete: 'CASCADE' })
  tenant!: Tenant;

  @Column()
  conversationId!: string;

  @ManyToOne(() => Conversation, (conversation) => conversation.id, {
    onDelete: 'CASCADE',
  })
  conversation!: Conversation;

  @Column()
  clientId!: string;

  @ManyToOne(() => Client, (client) => client.id, { onDelete: 'CASCADE' })
  client!: Client;

  @Column({ type: 'enum', enum: MessageRole })
  role!: MessageRole;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'json', nullable: true })
  rawJson?: any;

  @CreateDateColumn()
  createdAt!: Date;
}
