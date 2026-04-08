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

  @Column('decimal', { precision: 10, scale: 2 })
  priceAtBooking!: number;

  @Column('int')
  durationAtBooking!: number;

  @Column({ type: 'int', nullable: true })
  sequenceOrder?: number;
}
