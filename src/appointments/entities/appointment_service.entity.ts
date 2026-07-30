import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  Index,
  JoinColumn,
} from 'typeorm';
import { Appointment } from './appointment.entity';
import { Service } from '../../services/entities/service.entity';
import { Staff } from '../../staff/entities/staff.entity';

@Index(['appointmentId', 'serviceId'])
@Index(['staffId', 'startTime'])
@Index(['staffId', 'startTime', 'endTime'])
/**
 * Última barrera contra reservas duplicadas: dos segmentos activos no pueden
 * compartir profesional e instante de inicio.
 *
 * El índice va sobre `activeStartTime` y no sobre `startTime` a propósito. Cancelar
 * una cita no borra sus segmentos, y la disponibilidad vuelve a ofrecer ese
 * horario; con el índice sobre `startTime`, cualquier horario cancelado quedaría
 * bloqueado para siempre. `activeStartTime` se anula al cancelar, y MySQL admite
 * múltiples `NULL` en un índice único, así que los segmentos cancelados dejan de
 * competir por el horario.
 */
@Index(['staffId', 'activeStartTime'], { unique: true })
@Entity('appointment_services')
export class AppointmentService {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  appointmentId!: string;

  @ManyToOne(() => Appointment, (appointment) => appointment.services, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'appointmentId' })
  appointment!: Appointment;

  @Column()
  serviceId!: string;

  @ManyToOne(() => Service, (service) => service.appointmentServices, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'serviceId' })
  service!: Service;

  @Column()
  staffId!: string;

  @ManyToOne(() => Staff, (staff) => staff.appointmentServices, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'staffId' })
  staff!: Staff;

  @Column({ type: 'timestamp' })
  startTime!: Date;

  @Column({ type: 'timestamp' })
  endTime!: Date;

  /**
   * Copia de `startTime` mientras el segmento ocupa realmente la agenda, y `NULL`
   * cuando la cita fue cancelada. Solo existe para sostener el índice único que
   * impide reservas duplicadas; para leer el horario usar siempre `startTime`.
   */
  @Column({ type: 'timestamp', nullable: true })
  activeStartTime?: Date | null;

  @Column('decimal', { precision: 10, scale: 2 })
  priceAtBooking!: number;

  @Column('int')
  durationAtBooking!: number;

  @Column({ type: 'int', nullable: true })
  sequenceOrder?: number;
}
