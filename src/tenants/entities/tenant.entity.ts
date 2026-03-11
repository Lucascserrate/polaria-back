import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum BusinessType {
  HAIR_SALON = 'hair_salon',
  BARBER_SHOP = 'barber_shop',
  BEAUTY_SALON = 'beauty_salon',
  SPA = 'spa',
  DENTAL_CLINIC = 'dental_clinic',
  OTHER = 'other',
}

@Index(['whatsappPhoneNumber'], { unique: true })
@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({
    type: 'enum',
    enum: BusinessType,
    nullable: true,
  })
  businessType?: BusinessType;

  @Column()
  whatsappPhoneNumber: string;

  @Column()
  whatsappPhoneId: string;

  @Column()
  timezone: string;

  @Column()
  googleRefreshToken: string;

  @Column({ nullable: true })
  googleAccessToken?: string;

  @Column({ nullable: true })
  calendarId?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
