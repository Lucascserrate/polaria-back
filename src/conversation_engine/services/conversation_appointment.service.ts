import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Appointment,
  AppointmentStatus,
} from '../../appointments/entities/appointment.entity';
import { Service } from '../../services/entities/service.entity';
import { Staff } from '../../staff/entities/staff.entity';

@Injectable()
export class ConversationAppointmentService {
  constructor(
    @InjectRepository(Appointment)
    private readonly appointmentRepository: Repository<Appointment>,
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(Staff)
    private readonly staffRepository: Repository<Staff>,
  ) {}

  async createConfirmedAppointment(input: {
    tenantId: string;
    clientId: string;
    serviceId: string;
    startTime: Date;
  }) {
    const service = await this.serviceRepository.findOneBy({
      id: input.serviceId,
      tenantId: input.tenantId,
      isActive: true,
    });
    if (!service) {
      return null;
    }

    const staff = await this.staffRepository.findOneBy({
      tenantId: input.tenantId,
      isActive: true,
    });
    if (!staff) {
      return null;
    }

    const endTime = new Date(
      input.startTime.getTime() + service.durationMinutes * 60 * 1000,
    );

    const record = this.appointmentRepository.create({
      tenantId: input.tenantId,
      clientId: input.clientId,
      serviceId: input.serviceId,
      staffId: staff.id,
      startTime: input.startTime,
      endTime,
      status: AppointmentStatus.CONFIRMED,
    });
    return this.appointmentRepository.save(record);
  }
}
