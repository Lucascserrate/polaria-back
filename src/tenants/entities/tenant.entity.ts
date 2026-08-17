import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
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
  whatsappVerifiedName?: string;

  /**
   * Id del Flow de reservas publicado en la WABA de este tenant.
   *
   * Es lo que decide por qué canal se reserva: con un Flow publicado se abre el
   * formulario; sin él, se usan las listas y botones nativos. Un Flow pertenece a
   * una WABA, así que cada barbería necesita el suyo y no se puede compartir.
   */
  @Column({ type: 'text', nullable: true })
  whatsappFlowId?: string;

  @Column({ type: 'timestamp', nullable: true })
  whatsappConnectedAt?: Date;

  /**
   * Coexistence: el número sigue usándose desde la app de WhatsApp Business
   * en paralelo a Cloud API. Cambia lo que se puede hacer con el número
   * (no se registra, throughput fijo, llegan echoes de la app).
   */
  @Column({ default: false })
  whatsappIsOnBusinessApp!: boolean;

  @Column({ type: 'text', nullable: true })
  whatsappPlatformType?: string;

  @Column()
  timezone!: string;

  /**
   * Moneda del negocio en ISO 4217 (`BOB`, `ARS`, `USD`…).
   *
   * Va acá y no en cada servicio porque es un dato del negocio: una barbería no
   * cobra un servicio en bolivianos y otro en dólares. Ponerlo por servicio
   * duplicaría el mismo valor en cada fila y abriría la puerta a que diverjan.
   */
  @Column({ type: 'varchar', length: 3, default: 'BOB' })
  currency!: string;

  @Column({ nullable: true })
  email?: string;

  @Column({ nullable: true })
  googleId?: string;

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
