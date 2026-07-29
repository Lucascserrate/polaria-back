import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { BookingContextData, BookingStep } from '../types';

@Entity('conversation_state')
export class ConversationStateEntity {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  user_phone!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  tenant_id!: string | null;

  @Column({
    type: 'varchar',
    length: 64,
    default: 'inicio',
  })
  current_step!: BookingStep;

  @Column({ type: 'json', nullable: true })
  context!: BookingContextData | null;

  @UpdateDateColumn()
  updated_at!: Date;

  @Index()
  @Column({ type: 'timestamp', nullable: true })
  expires_at!: Date | null;
}
