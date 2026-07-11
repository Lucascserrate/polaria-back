import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { AuthProvider } from '../../auth/domain/enums/auth.enum';
import { Staff } from '../../staff/entities/staff.entity';
import { Service } from '../../services/entities/service.entity';
import { Client } from '../../clients/entities/client.entity';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { Message } from '../../messages/entities/message.entity';
import { BusinessHour } from '../../business_hours/entities/business_hour.entity';

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

  @Column({ type: 'text', nullable: true })
  whatsappPhoneId?: string;

  @Column({ type: 'text', nullable: true })
  whatsappAccessToken?: string;

  @Column({ type: 'text', nullable: true })
  whatsappBusinessId?: string;

  @Column({ type: 'text', nullable: true })
  whatsappWabaId?: string;

  @Column({ type: 'text', nullable: true })
  whatsappSystemUserAccessToken?: string;

  @Column({ type: 'text', nullable: true })
  whatsappVerifiedName?: string;

  @Column({ type: 'timestamp', nullable: true })
  whatsappConnectedAt?: Date;

  @Column()
  timezone!: string;

  @Column({ nullable: true })
  email?: string;

  @Column({ nullable: true })
  googleId?: string;

  @Column({
    type: 'enum',
    enum: AuthProvider,
    default: AuthProvider.GOOGLE,
  })
  provider!: AuthProvider;

  @Column({ default: 'active' })
  status?: string;

  @Column({ default: true })
  aiEnabled!: boolean;

  @Column({ nullable: true })
  googleRefreshToken?: string;

  @Column({ nullable: true })
  googleAccessToken?: string;

  @Column({ nullable: true })
  calendarId?: string;

  @OneToMany(() => Staff, (staff) => staff.tenant)
  staff?: Staff[];

  @OneToMany(() => Service, (service) => service.tenant)
  services?: Service[];

  @OneToMany(() => Client, (client) => client.tenant)
  clients?: Client[];

  @OneToMany(() => Conversation, (conversation) => conversation.tenant)
  conversations?: Conversation[];

  @OneToMany(() => Message, (message) => message.tenant)
  messages?: Message[];

  @OneToMany(() => BusinessHour, (businessHour) => businessHour.tenant)
  businessHours?: BusinessHour[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
