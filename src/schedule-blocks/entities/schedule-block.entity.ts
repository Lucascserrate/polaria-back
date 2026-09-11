import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Staff } from '../../staff/entities/staff.entity';

/**
 * Una franja marcada como no disponible.
 *
 * Es la excepción **por fecha** que `staff_schedules` no puede expresar: esas
 * filas son una jornada recurrente —"los martes de 09:00 a 18:00"— y este
 * bloqueo es un rato concreto de un día concreto en el que no se atiende, sea
 * porque alguien salió o porque pasó algo en el local.
 *
 * Guarda instantes absolutos y no día + hora de reloj, igual que `appointments`.
 * La razón es la misma: el bloqueo se compara contra citas y contra franjas de
 * atención ya resueltas a instantes, y tener una de las tres cosas en otra
 * unidad obligaría a convertir en cada comparación.
 *
 * `staffId` en `null` significa **todo el negocio**. No es la ausencia del dato:
 * es el caso de "hoy no abrimos a la tarde", que con una fila por persona se
 * escribiría varias veces y se borraría de a una.
 */
@Index(['tenantId', 'startTime'])
/**
 * La consulta que manda es "los bloqueos de esta persona en este rango", y va a
 * correr en cada cálculo de disponibilidad. El índice de arriba no le alcanza:
 * MySQL leería los bloqueos de todo el equipo para después descartar por
 * profesional.
 */
@Index(['tenantId', 'staffId', 'startTime'])
@Entity('schedule_blocks')
export class ScheduleBlock {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  tenantId!: string;
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;

  /** `null` = todo el negocio. Ver el comentario de la clase. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  staffId!: string | null;
  @ManyToOne(() => Staff, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'staffId' })
  staff!: Staff | null;

  @Column({ type: 'timestamp' })
  startTime!: Date;

  @Column({ type: 'timestamp' })
  endTime!: Date;

  /**
   * Por qué no se atiende, en palabras de quien lo cargó.
   *
   * Opcional y solo para el panel: el cliente ve menos horarios, nunca el
   * motivo. Existe porque un bloqueo sin explicación, mirado a la semana
   * siguiente, no se distingue de un error de carga y nadie se anima a borrarlo.
   */
  @Column({ type: 'varchar', length: 140, nullable: true })
  reason!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
