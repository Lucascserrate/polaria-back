import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Staff } from './entities/staff.entity';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { Service } from '../services/entities/service.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { AppointmentService as AppointmentServiceEntity } from '../appointments/entities/appointment_service.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { normalizeTimezone } from '../common/timezone.util';

@Injectable()
export class StaffService {
  constructor(
    @InjectRepository(Staff)
    private staffRepository: Repository<Staff>,
    @InjectRepository(Service)
    private serviceRepository: Repository<Service>,
    @InjectRepository(AppointmentServiceEntity)
    private appointmentServiceRepository: Repository<AppointmentServiceEntity>,
    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,
  ) {}

  async create(createStaffDto: CreateStaffDto): Promise<Staff> {
    const { serviceIds, ...rest } = createStaffDto;
    const staff = this.staffRepository.create(rest);

    if (Array.isArray(serviceIds) && serviceIds.length) {
      const services = await this.serviceRepository.find({
        where: { id: In(serviceIds), tenantId: staff.tenantId },
        order: { name: 'ASC' },
      });
      if (services.length !== serviceIds.length) {
        throw new BadRequestException(
          'One or more services are invalid for this tenant',
        );
      }
      staff.services = services;
    }

    return this.staffRepository.save(staff);
  }

  findAll(): Promise<Staff[]> {
    return this.staffRepository.find({ relations: { services: true } });
  }

  findOne(id: string): Promise<Staff | null> {
    return this.staffRepository.findOne({
      where: { id },
      relations: { services: true },
    });
  }

  findByTenant(tenantId: string): Promise<Staff[]> {
    return this.staffRepository
      .createQueryBuilder('staff')
      .leftJoinAndSelect('staff.services', 'service')
      .where('staff.tenantId = :tenantId', { tenantId })
      .orderBy('staff.name', 'ASC')
      .getMany();
  }

  async update(id: string, updateStaffDto: UpdateStaffDto) {
    const staff = await this.staffRepository.findOne({
      where: { id },
      relations: { services: true },
    });
    if (!staff) return null;

    const { serviceIds, ...rest } = updateStaffDto;
    this.staffRepository.merge(staff, rest);

    if (Array.isArray(serviceIds)) {
      if (!serviceIds.length) {
        staff.services = [];
      } else {
        const services = await this.serviceRepository.find({
          where: { id: In(serviceIds), tenantId: staff.tenantId },
          order: { name: 'ASC' },
        });
        if (services.length !== serviceIds.length) {
          throw new BadRequestException(
            'One or more services are invalid for this tenant',
          );
        }
        staff.services = services;
      }
    }

    await this.staffRepository.save(staff);
    return this.findOne(id);
  }

  async remove(id: string, tenantId: string) {
    const tenant = await this.tenantRepository.findOne({
      where: { id: tenantId },
    });
    const timezone = normalizeTimezone(tenant?.timezone);
    const currentDateTime = this.getCurrentDateTimeInTimezone(timezone);

    const futureAppointmentCount = await this.appointmentServiceRepository
      .createQueryBuilder('appointmentService')
      .innerJoin(
        Appointment,
        'appointment',
        'appointment.id = appointmentService.appointmentId',
      )
      .where('appointmentService.staffId = :staffId', { staffId: id })
      .andWhere('appointment.tenantId = :tenantId', { tenantId })
      .andWhere('appointment.startTime > :currentDateTime', { currentDateTime })
      .getCount();

    if (futureAppointmentCount > 0) {
      throw new ConflictException(
        'Este miembro del staff no puede eliminarse porque tiene citas futuras programadas.',
      );
    }

    await this.staffRepository.update({ id, tenantId }, { isActive: false });
    await this.staffRepository.softDelete({ id, tenantId });
    return { deleted: true };
  }

  private getCurrentDateTimeInTimezone(timezone: string): Date {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const year = Number(parts.find((p) => p.type === 'year')?.value ?? '1970');
    const month = Number(parts.find((p) => p.type === 'month')?.value ?? '1');
    const day = Number(parts.find((p) => p.type === 'day')?.value ?? '1');
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    const second = Number(parts.find((p) => p.type === 'second')?.value ?? '0');

    return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  }
}
