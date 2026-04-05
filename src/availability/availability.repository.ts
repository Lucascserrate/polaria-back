import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import {
  Appointment,
  AppointmentStatus,
} from '../appointments/entities/appointment.entity';
import { BusinessHour } from '../business_hours/entities/business_hour.entity';
import { Service } from '../services/entities/service.entity';
import { Staff } from '../staff/entities/staff.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { makeDateInTimeZone, addMinutes } from './utils/availability.helpers';

@Injectable()
export class AvailabilityRepository {
  constructor(
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    @InjectRepository(BusinessHour)
    private readonly businessHourRepository: Repository<BusinessHour>,
    @InjectRepository(Staff)
    private readonly staffRepository: Repository<Staff>,
    @InjectRepository(Appointment)
    private readonly appointmentRepository: Repository<Appointment>,
  ) {}

  async getTenant(tenantId: string): Promise<Tenant | null> {
    return this.tenantRepository.findOneBy({ id: tenantId });
  }

  async getServices(
    tenantId: string,
    serviceIds: string[],
  ): Promise<Service[]> {
    if (!serviceIds.length) return [];
    return this.serviceRepository.find({
      where: {
        id: In(serviceIds),
        tenantId,
      },
    });
  }

  async getBusinessHours(
    tenantId: string,
    dayOfWeek: number,
  ): Promise<BusinessHour[]> {
    return this.businessHourRepository.find({
      where: {
        tenantId,
        dayOfWeek,
      },
      order: { startTime: 'ASC' },
    });
  }

  async getStaffList(tenantId: string, staffId?: string): Promise<Staff[]> {
    if (staffId) {
      const staff = await this.staffRepository.findOneBy({
        id: staffId,
        tenantId,
      });
      return staff && staff.isActive ? [staff] : [];
    }

    return this.staffRepository.find({
      where: {
        tenantId,
        isActive: true,
      },
      order: { name: 'ASC' },
    });
  }

  async getAppointments(
    tenantId: string,
    desiredDate: string,
    staffId?: string,
  ): Promise<Appointment[]> {
    const dayStart = makeDateInTimeZone(desiredDate, '00:00');
    const nextDayStart = addMinutes(dayStart, 24 * 60);
    const dayEnd = new Date(nextDayStart.getTime() - 1);

    const whereClause: Record<string, unknown> = {
      tenantId,
      status: In([AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED]),
      startTime: Between(dayStart, dayEnd),
    };

    if (staffId) {
      whereClause.staffId = staffId;
    }

    return this.appointmentRepository.find({
      where: whereClause,
      order: { startTime: 'ASC' },
    });
  }
}
