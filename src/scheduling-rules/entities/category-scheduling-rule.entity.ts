import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';

import { Tenant } from '../../tenants/entities/tenant.entity';
import { ServiceCategory } from '../../service-categories/entities/service-category.entity';
import { SchedulingMode } from '../scheduling-mode';

/**
 * Una regla de tiempo entre dos categorías: "Manicures y Pedicures se pueden
 * hacer al mismo tiempo".
 *
 * Tabla propia y no un campo en `service_categories` por tres razones, y las
 * tres son de las que se pagan tarde:
 *
 * 1. Es una relación binaria, no un atributo. Un campo en la categoría sólo
 *    podría nombrar a una, y un salón puede declarar que las uñas conviven con
 *    los pies y también con las cejas.
 * 2. Las categorías son navegación del catálogo: ordenan el menú de WhatsApp y
 *    agrupan el panel. Si además decidieran cómo se agenda, el negocio que
 *    reordena su menú cambiaría sin querer la duración de sus reservas.
 * 3. La regla va a querer crecer —excepciones por servicio, y algún día
 *    recursos: sillones, salas, aparatos—. Naciendo afuera, crecer no obliga a
 *    migrar categorías.
 *
 * **La relación es simétrica y se guarda una sola vez.** El par viaja siempre
 * con `categoryAId < categoryBId` por comparación de texto, que es lo que hace
 * cumplible el índice único. Dos filas para el mismo par —una por sentido— es el
 * origen clásico del estado en que A permite B pero B no permite A, que ninguna
 * pantalla sabe dibujar y nadie sabe corregir.
 *
 * Una categoría consigo misma no se guarda: significaría dos manicures a la vez
 * sobre la misma clienta, que no existe. Lo rechaza el servicio.
 */
@Entity('category_scheduling_rules')
@Unique('UQ_category_scheduling_rules_pair', [
  'tenantId',
  'categoryAId',
  'categoryBId',
])
/**
 * La consulta que manda es "todas las reglas de este negocio", y corre en cada
 * cálculo de disponibilidad de una reserva con varios servicios. Son pocas filas
 * por negocio, así que se leen todas juntas y se resuelven en memoria.
 */
@Index(['tenantId'])
export class CategorySchedulingRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;

  /** La de id menor. Ver el comentario de la clase. */
  @Column({ type: 'varchar', length: 36 })
  categoryAId!: string;

  @ManyToOne(() => ServiceCategory, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'categoryAId' })
  categoryA!: ServiceCategory;

  /** La de id mayor. */
  @Column({ type: 'varchar', length: 36 })
  categoryBId!: string;

  @ManyToOne(() => ServiceCategory, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'categoryBId' })
  categoryB!: ServiceCategory;

  /**
   * Qué declara la regla. Ver `SchedulingMode`.
   *
   * `varchar` y no `enum` de MySQL por lo mismo que `services.bookingPolicy`:
   * sumar un modo sería un `ALTER TABLE`, y el valor lo valida el DTO antes de
   * llegar acá.
   */
  @Column({ type: 'varchar', length: 24, default: SchedulingMode.PARALLEL })
  mode!: SchedulingMode;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
