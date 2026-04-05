import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Appointment } from './entities/appointment.entity';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AvailabilityService } from '../availability/availability.service';
import { AppointmentService as AppointmentServiceEntity } from './entities/appointment_service.entity';
import { Service } from '../services/entities/service.entity';
import { AppointmentStatus } from './entities/appointment.entity';

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectRepository(Appointment)
    private appointmentRepository: Repository<Appointment>,
    @InjectRepository(AppointmentServiceEntity)
    private appointmentServiceRepository: Repository<AppointmentServiceEntity>,
    @InjectRepository(Service)
    private serviceRepository: Repository<Service>,
    private readonly availabilityService: AvailabilityService,
  ) {}

  create(createAppointmentDto: CreateAppointmentDto) {
    const appointment = this.appointmentRepository.create(createAppointmentDto);
    return this.appointmentRepository.save(appointment);
  }

  async findAll() {
    const appointments = await this.appointmentRepository.find({
      relations: {
        client: true,
        staff: true,
        tenant: true,
      },
      order: { startTime: 'ASC' },
    });

    return appointments.map((a) => {
      const timezone = a.tenant?.timezone ?? 'America/La_Paz';
      return {
        id: a.id,
        startTime: a.startTime,
        endTime: a.endTime,
        startTimeFormatted: this.formatDateTime(a.startTime, timezone),
        endTimeFormatted: this.formatDateTime(a.endTime, timezone),
        status: a.status,
        clientName: a.client?.name,
        staffName: a.staff?.name,
        businessName: a.tenant?.name,
        timezone,
      };
    });
  }

  findOne(id: string) {
    return this.appointmentRepository.findOneBy({ id });
  }

  async update(id: string, updateAppointmentDto: UpdateAppointmentDto) {
    await this.appointmentRepository.update(id, updateAppointmentDto);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.appointmentRepository.delete(id);
    return { deleted: true };
  }

  async createFromAssistant(input: {
    tenantId: string;
    clientId: string;
    serviceIds: string[];
    staffId?: string;
    date: string;
    time: string;
  }): Promise<Appointment> {
    const availability = await this.availabilityService.findAvailableSlots({
      tenantId: input.tenantId,
      serviceIds: input.serviceIds,
      desiredDate: input.date,
      desiredTime: input.time,
      staffId: input.staffId,
    });

    if (!availability.isAvailable || availability.suggestedSlots.length === 0) {
      throw new Error('Slot ya no disponible');
    }

    const slot = availability.suggestedSlots[0];
    const appointment = await this.appointmentRepository.save({
      tenantId: input.tenantId,
      staffId: slot.staffId,
      clientId: input.clientId,
      startTime: new Date(slot.startTime),
      endTime: new Date(slot.endTime),
      status: AppointmentStatus.CONFIRMED,
      reminderSent: false,
    });

    const services = await this.serviceRepository.find({
      where: {
        id: In(input.serviceIds),
        tenantId: input.tenantId,
      },
    });

    const appointmentServices = services.map((service, index) =>
      this.appointmentServiceRepository.create({
        appointmentId: appointment.id,
        serviceId: service.id,
        staffId: slot.staffId,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        priceAtBooking: service.price,
        durationAtBooking: service.durationMinutes,
        sequenceOrder: index,
      }),
    );

    if (appointmentServices.length > 0) {
      await this.appointmentServiceRepository.save(appointmentServices);
    }

    return appointment;
  }

  private formatDateTime(date: Date, timezone: string): string {
    const formatter = new Intl.DateTimeFormat('es-CO', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return formatter.format(date);
  }
}
