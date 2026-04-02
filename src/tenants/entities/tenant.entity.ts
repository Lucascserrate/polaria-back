import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Index(['whatsappPhoneNumber'], { unique: true })
@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ nullable: true })
  businessType?: string;

  @Column()
  whatsappPhoneNumber!: string;

  @Column()
  whatsappPhoneId!: string;

  @Column()
  timezone!: string;

  @Column({ nullable: true })
  email?: string;

  @Column({ nullable: true })
  googleId?: string;

  @Column({ default: 'active' })
  status!: string;

  @Column({ nullable: true })
  googleRefreshToken?: string;

  @Column({ nullable: true })
  googleAccessToken?: string;

  @Column({ nullable: true })
  calendarId?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
