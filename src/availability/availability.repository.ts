import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Appointment,
  AppointmentStatus,
} from '../appointments/entities/appointment.entity';
import { AppointmentService as AppointmentServiceEntity } from '../appointments/entities/appointment_service.entity';
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
    @InjectRepository(AppointmentServiceEntity)
    private readonly appointmentServiceRepository: Repository<AppointmentServiceEntity>,
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
        isActive: true,
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

  async getStaffList(
    tenantId: string,
    serviceIds: string[],
    staffId?: string,
  ): Promise<Staff[]> {
    const uniqueServiceIds = Array.from(new Set(serviceIds)).filter(Boolean);

    if (staffId) {
      const staff = await this.staffRepository.findOne({
        where: { id: staffId, tenantId, isActive: true },
        relations: { services: true },
      });
      if (!staff) return [];

      if (uniqueServiceIds.length) {
        const staffServiceIds = new Set(staff.services?.map((s) => s.id) ?? []);
        const canDoAll = uniqueServiceIds.every((id) =>
          staffServiceIds.has(id),
        );
        return canDoAll ? [staff] : [];
      }

      return staff && staff.isActive ? [staff] : [];
    }

    const qb = this.staffRepository
      .createQueryBuilder('staff')
      .leftJoin('staff.services', 'service')
      .where('staff.tenantId = :tenantId', { tenantId })
      .andWhere('staff.isActive = :isActive', { isActive: true });

    if (uniqueServiceIds.length) {
      qb.andWhere('service.id IN (:...serviceIds)', {
        serviceIds: uniqueServiceIds,
      })
        .groupBy('staff.id')
        .having('COUNT(DISTINCT service.id) = :count', {
          count: uniqueServiceIds.length,
        });
    }

    return qb.orderBy('staff.name', 'ASC').getMany();
  }

  async getActiveStaffWithServices(tenantId: string): Promise<Staff[]> {
    return this.staffRepository.find({
      where: { tenantId, isActive: true },
      order: { name: 'ASC' },
      relations: { services: true },
    });
  }

  async getAppointmentsByStaff(
    tenantId: string,
    desiredDate: string,
    timeZone: string,
    staffIds: string[],
  ): Promise<Record<string, Array<{ startTime: Date; endTime: Date }>>> {
    const uniqueStaffIds = Array.from(new Set(staffIds)).filter(Boolean);
    if (!uniqueStaffIds.length) return {};

    const dayStart = makeDateInTimeZone(desiredDate, '00:00', timeZone);
    const nextDayStart = addMinutes(dayStart, 24 * 60);
    const dayEnd = new Date(nextDayStart.getTime() - 1);

    const segments = await this.appointmentServiceRepository
      .createQueryBuilder('as')
      .innerJoin('as.appointment', 'a')
      .where('a.tenantId = :tenantId', { tenantId })
      .andWhere('a.status IN (:...statuses)', {
        statuses: [
          AppointmentStatus.PENDING,
          AppointmentStatus.BOOKED,
          AppointmentStatus.CONFIRMED,
        ],
      })
      .andWhere('as.staffId IN (:...staffIds)', { staffIds: uniqueStaffIds })
      .andWhere('as.startTime BETWEEN :dayStart AND :dayEnd', {
        dayStart,
        dayEnd,
      })
      .orderBy('as.startTime', 'ASC')
      .getMany();

    const grouped: Record<
      string,
      Array<{ startTime: Date; endTime: Date }>
    > = {};
    for (const id of uniqueStaffIds) grouped[id] = [];
    for (const seg of segments) {
      if (!seg.staffId) continue;
      grouped[seg.staffId] ??= [];
      grouped[seg.staffId].push({
        startTime: seg.startTime,
        endTime: seg.endTime,
      });
    }
    return grouped;
  }

  async getAppointments(
    tenantId: string,
    desiredDate: string,
    timeZone: string,
    staffId?: string,
  ): Promise<Array<{ startTime: Date; endTime: Date }>> {
    const dayStart = makeDateInTimeZone(desiredDate, '00:00', timeZone);
    const nextDayStart = addMinutes(dayStart, 24 * 60);
    const dayEnd = new Date(nextDayStart.getTime() - 1);

    const qb = this.appointmentServiceRepository
      .createQueryBuilder('as')
      .select(['as.startTime', 'as.endTime', 'as.staffId'])
      .innerJoin('as.appointment', 'a')
      .where('a.tenantId = :tenantId', { tenantId })
      .andWhere('a.status IN (:...statuses)', {
        statuses: [
          AppointmentStatus.PENDING,
          AppointmentStatus.BOOKED,
          AppointmentStatus.CONFIRMED,
        ],
      })
      .andWhere('as.startTime BETWEEN :dayStart AND :dayEnd', {
        dayStart,
        dayEnd,
      })
      .orderBy('as.startTime', 'ASC');

    if (staffId) {
      qb.andWhere('as.staffId = :staffId', { staffId });
    }

    const segments = await qb.getMany();
    return segments.map((s) => ({
      startTime: s.startTime,
      endTime: s.endTime,
    }));
  }
}
