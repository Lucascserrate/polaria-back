import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('processed_whatsapp_message')
export class ProcessedWhatsappMessageEntity {
  @PrimaryColumn({ type: 'varchar', length: 80 })
  message_id!: string;

  @Column({ type: 'varchar', length: 32 })
  user_phone!: string;

  @Column({ type: 'timestamp' })
  processed_at!: Date;
}
