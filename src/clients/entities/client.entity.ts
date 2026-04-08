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

  @Column()
  phone!: string;

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
