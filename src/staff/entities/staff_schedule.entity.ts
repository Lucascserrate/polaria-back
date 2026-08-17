import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  JoinColumn,
} from 'typeorm';
import { Staff } from './staff.entity';

/**
 * Jornada semanal de un profesional.
 *
 * Solo se lee cuando su `Staff.usesCustomSchedule` está encendido; con el flag
 * apagado estas filas se ignoran por completo y el profesional hereda el horario
 * del negocio.
 *
 * Igual que `business_hours`, admite varias filas por día para representar
 * turnos partidos (por ejemplo 09:00–13:00 y 15:00–20:00).
 *
 * Es una jornada **recurrente**: no expresa vacaciones ni feriados. Esas son
 * excepciones por fecha y viven en otra capa, que `resolveWorkingRanges` podrá
 * aplicar sin que estas filas cambien de significado.
 */
@Index(['staffId', 'dayOfWeek'])
@Entity('staff_schedules')
export class StaffSchedule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  staffId!: string;

  @ManyToOne(() => Staff, (staff) => staff.schedules, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'staffId' })
  staff!: Staff;

  /** 0 = domingo, igual que `business_hours` y que `getDayOfWeek`. */
  @Column({ type: 'int' })
  dayOfWeek!: number;

  @Column({ type: 'time' })
  startTime!: string;

  @Column({ type: 'time' })
  endTime!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
