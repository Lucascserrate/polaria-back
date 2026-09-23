import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Service } from '../../services/entities/service.entity';

/**
 * Una forma de agrupar el catálogo: "Cabello", "Uñas", "Barbería".
 *
 * Tabla propia y no un texto en cada servicio porque la categoría se renombra
 * —y renombrar tiene que alcanzar a los treinta servicios de una vez, no
 * convertirse en treinta ediciones— y porque una categoría puede existir vacía:
 * el negocio la crea primero y después le va metiendo servicios.
 */
@Entity('service_categories')
@Unique('UQ_service_categories_tenant_name', ['tenantId', 'name'])
export class ServiceCategory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;

  @Column()
  name!: string;

  /**
   * Para qué es esta categoría, en una línea.
   *
   * Opcional en la pantalla, pero es lo que va a ocupar el subtítulo de la fila
   * cuando el menú de WhatsApp liste categorías: ahí una lista de nombres sueltos
   * obliga a adivinar qué hay adentro de cada una.
   */
  /*
   * El `type` explícito es obligatorio con una unión que incluye `null`: de
   * `string | null` TypeORM reflexiona `Object` y la app no arranca. Ver
   * `entity-metadata.spec.ts`.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  description?: string | null;

  /**
   * En qué orden se muestran las categorías entre sí.
   *
   * El orden lo decide el negocio y no el alfabeto porque es el orden del menú:
   * lo que más se pide va primero. Las que empatan en `position` —todas, hasta
   * que exista la pantalla para reordenarlas— caen al nombre.
   */
  @Column('int', { default: 0 })
  position!: number;

  @OneToMany(() => Service, (service: Service) => service.category)
  services!: Service[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
