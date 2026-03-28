import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Appointment,
  AppointmentStatus,
} from '../../appointments/entities/appointment.entity';
import { AppointmentService } from '../../appointments/entities/appointment_service.entity';
import { Service } from '../../services/entities/service.entity';
import { Staff } from '../../staff/entities/staff.entity';
import { ConversationAvailabilityService } from './conversation_availability.service';

@Injectable()
export class ConversationAppointmentService {
  constructor(
    @InjectRepository(Appointment)
    private readonly appointmentRepository: Repository<Appointment>,
    @InjectRepository(AppointmentService)
    private readonly appointmentServiceRepository: Repository<AppointmentService>,
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(Staff)
    private readonly staffRepository: Repository<Staff>,
    private readonly conversationAvailabilityService: ConversationAvailabilityService,
  ) {}

  async createConfirmedAppointment(input: {
    tenantId: string;
    clientId: string;
    serviceIds: string[];
    startTime: Date;
    staffId?: string | null;
    timezone?: string;
  }) {
    const serviceIds = input.serviceIds.filter(Boolean);
    if (!serviceIds.length) {
      return null;
    }

    const services = await this.serviceRepository.find({
      where: serviceIds.map((id) => ({
        id,
        tenantId: input.tenantId,
        isActive: true,
      })),
    });
    if (!services.length || services.length !== serviceIds.length) {
      return null;
    }

    const totalDuration = services.reduce(
      (sum, service) => sum + service.durationMinutes,
      0,
    );
    const endTime = new Date(
      input.startTime.getTime() + totalDuration * 60 * 1000,
    );

    const staffId = await this.conversationAvailabilityService
      .findAvailableStaffIdForSlot({
        tenantId: input.tenantId,
        start: input.startTime,
        end: endTime,
        timezone: input.timezone,
        staffId: input.staffId ?? null,
      })
      .then((id) => id ?? null);
    if (!staffId) {
      return null;
    }
    const stillAvailable =
      await this.conversationAvailabilityService.isSlotAvailable(
        input.tenantId,
        input.startTime,
        endTime,
        input.timezone,
        staffId,
      );
    if (!stillAvailable) {
      return null;
    }
    const staff = await this.staffRepository.findOneBy({ id: staffId });
    if (!staff) {
      return null;
    }

    const record = this.appointmentRepository.create({
      tenantId: input.tenantId,
      clientId: input.clientId,
      serviceId: serviceIds[0],
      staffId,
      startTime: input.startTime,
      endTime,
      status: AppointmentStatus.CONFIRMED,
    });
    const saved = await this.appointmentRepository.save(record);

    let cursor = new Date(input.startTime);
    const rows = services.map((service, index) => {
      const serviceStart = new Date(cursor);
      const serviceEnd = new Date(
        serviceStart.getTime() + service.durationMinutes * 60 * 1000,
      );
      cursor = new Date(serviceEnd);
      return this.appointmentServiceRepository.create({
        appointmentId: saved.id,
        serviceId: service.id,
        staffId,
        startTime: serviceStart,
        endTime: serviceEnd,
        priceAtBooking: Number(service.price),
        durationAtBooking: service.durationMinutes,
        sequenceOrder: index + 1,
      });
    });
    await this.appointmentServiceRepository.save(rows);

    return saved;
  }
}
