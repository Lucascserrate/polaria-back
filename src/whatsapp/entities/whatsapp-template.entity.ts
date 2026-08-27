import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Tenant } from '../../tenants/entities/tenant.entity';

/**
 * Estado de una plantilla de WhatsApp en la WABA de un negocio.
 *
 * Antes esto eran cuatro columnas de `tenants` —`reminderTemplateName`,
 * `Language`, `Status`, `MetaStatus`— porque había exactamente una plantilla. Con
 * la segunda eso deja de cerrar: serían ocho columnas, y el job que relee
 * aprobaciones y el webhook de Meta tenían "la" plantilla cableada en singular.
 *
 * Una fila por negocio y por plantilla. El `templateKey` es nuestro nombre interno
 * —ver `TemplateKey`— y no el de Meta: el de Meta vive en `name` y puede cambiar
 * (una plantilla nueva es un nombre nuevo) sin que el resto del sistema se enteree.
 */
@Index(['tenantId', 'templateKey'], { unique: true })
/** El job de aprobaciones consulta por estado; sin esto barre la tabla entera. */
@Index(['status'])
@Entity('whatsapp_templates')
export class WhatsAppTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;

  /** Nuestro nombre interno. Ver `TemplateKey`. */
  @Column({ type: 'varchar', length: 32 })
  templateKey!: string;

  /** Nombre con el que Meta la conoce. Al enviar tiene que coincidir exacto. */
  @Column({ type: 'varchar', length: 512 })
  name!: string;

  /** Idioma con el que se aprobó. Al enviar tiene que coincidir exacto. */
  @Column({ type: 'varchar', length: 16 })
  language!: string;

  /** `TemplateStatus`. Solo `APPROVED` habilita el envío. */
  @Column({ type: 'varchar', length: 32 })
  status!: string;

  /**
   * Estado tal como lo informa Meta.
   *
   * Nuestro `UNAVAILABLE` agrupa rechazada, pausada, deshabilitada y borrada. Sin
   * el valor original no hay forma de decirle al negocio cuál de las cuatro le
   * está pasando.
   */
  @Column({ type: 'varchar', length: 32, nullable: true })
  metaStatus!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
