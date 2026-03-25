import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Appointment } from './entities/appointment.entity';
import { AppointmentService } from './entities/appointment_service.entity';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectRepository(Appointment)
    private appointmentRepository: Repository<Appointment>,
    @InjectRepository(AppointmentService)
    private appointmentServiceRepository: Repository<AppointmentService>,
  ) {}

  async create(createAppointmentDto: CreateAppointmentDto) {
    const serviceIds = readServiceIds(
      createAppointmentDto.serviceIds,
      createAppointmentDto.serviceId,
    );
    const appointment = this.appointmentRepository.create({
      tenantId: createAppointmentDto.tenantId,
      staffId: createAppointmentDto.staffId,
      clientId: createAppointmentDto.clientId,
      serviceId: serviceIds?.[0],
      startTime: createAppointmentDto.startTime,
      endTime: createAppointmentDto.endTime,
      status: createAppointmentDto.status,
      googleEventId: createAppointmentDto.googleEventId,
      reminderSent: createAppointmentDto.reminderSent ?? false,
    });
    const saved = await this.appointmentRepository.save(appointment);

    if (serviceIds?.length) {
      const rows = serviceIds.map((serviceId, index) =>
        this.appointmentServiceRepository.create({
          appointmentId: saved.id,
          serviceId,
          staffId: saved.staffId,
          startTime: saved.startTime,
          endTime: saved.endTime,
          priceAtBooking: 0,
          durationAtBooking: Math.round(
            (saved.endTime.getTime() - saved.startTime.getTime()) / 60000,
          ),
          sequenceOrder: index + 1,
        }),
      );
      await this.appointmentServiceRepository.save(rows);
    }

    return saved;
  }

  findAll() {
    return this.appointmentRepository.find();
  }

  findOne(id: string) {
    return this.appointmentRepository.findOneBy({ id });
  }

  async update(id: string, updateAppointmentDto: UpdateAppointmentDto) {
    await this.appointmentRepository.update(id, updateAppointmentDto);
    const updated = await this.findOne(id);
    const serviceIds = readServiceIds(
      updateAppointmentDto.serviceIds,
      updateAppointmentDto.serviceId,
    );
    if (serviceIds) {
      await this.appointmentServiceRepository.delete({ appointmentId: id });
      if (serviceIds.length && updated) {
        const rows = serviceIds.map((serviceId, index) =>
          this.appointmentServiceRepository.create({
            appointmentId: id,
            serviceId,
            staffId: updated.staffId,
            startTime: updated.startTime,
            endTime: updated.endTime,
            priceAtBooking: 0,
            durationAtBooking: Math.round(
              (updated.endTime.getTime() - updated.startTime.getTime()) / 60000,
            ),
            sequenceOrder: index + 1,
          }),
        );
        await this.appointmentServiceRepository.save(rows);
      }
    }
    return updated;
  }

  async remove(id: string) {
    await this.appointmentRepository.delete(id);
    return { deleted: true };
  }
}

function readServiceIds(
  serviceIds: unknown,
  serviceId: unknown,
): string[] | null {
  if (Array.isArray(serviceIds)) {
    return serviceIds.filter(
      (value): value is string => typeof value === 'string',
    );
  }
  if (typeof serviceId === 'string') {
    return [serviceId];
  }
  return null;
}
