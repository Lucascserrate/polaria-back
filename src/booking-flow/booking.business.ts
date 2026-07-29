import { Injectable } from '@nestjs/common';
import { AppointmentsService } from '../appointments/appointments.service';
import { ServicesService } from '../services/services.service';
import { StaffService } from '../staff/staff.service';
import { AvailabilityService } from '../availability/availability.service';

@Injectable()
export class BookingBusinessService {
  constructor(
    private readonly servicesService: ServicesService,
    private readonly staffService: StaffService,
    private readonly availabilityService: AvailabilityService,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  listServices(tenantId: string) {
    return this.servicesService.findActiveByTenant(tenantId);
  }

  listStaffForService(tenantId: string, serviceId: string) {
    return this.staffService
      .findByTenant(tenantId)
      .then((staff) =>
        staff.filter(
          (member) =>
            member.isActive && member.services?.some((s) => s.id === serviceId),
        ),
      );
  }

  async listAvailableDates(
    tenantId: string,
    staffId: string,
    serviceId: string,
  ) {
    const today = new Date();
    const dates: string[] = [];
    for (let offset = 0; offset < 14; offset += 1) {
      const date = new Date(today.getTime() + offset * 24 * 60 * 60 * 1000);
      const iso = date.toISOString().slice(0, 10);
      const availability = await this.availabilityService.findAvailableSlots({
        tenantId,
        serviceIds: [serviceId],
        desiredDate: iso,
        desiredTime: '09:00',
        staffId,
      });
      if (availability.isAvailable) dates.push(iso);
      if (dates.length >= 5) break;
    }
    return dates;
  }

  async listAvailableTimes(
    tenantId: string,
    serviceId: string,
    staffId: string,
    date: string,
  ) {
    const availability = await this.availabilityService.findAvailableSlots({
      tenantId,
      serviceIds: [serviceId],
      desiredDate: date,
      desiredTime: '09:00',
      staffId,
    });
    return availability.suggestedSlots;
  }

  validateAvailability(input: {
    tenantId: string;
    serviceId: string;
    staffId: string;
    date: string;
    time: string;
  }) {
    return this.availabilityService.findAvailableSlots({
      tenantId: input.tenantId,
      serviceIds: [input.serviceId],
      desiredDate: input.date,
      desiredTime: input.time,
      staffId: input.staffId,
    });
  }

  createAppointment(input: {
    tenantId: string;
    clientId: string;
    serviceId: string;
    staffId: string;
    date: string;
    time: string;
  }) {
    return this.appointmentsService.createFromAssistant({
      tenantId: input.tenantId,
      clientId: input.clientId,
      serviceIds: [input.serviceId],
      staffId: input.staffId,
      date: input.date,
      time: input.time,
    });
  }
}
