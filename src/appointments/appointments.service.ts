import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';

import { Appointment } from './entities/appointment.entity';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AvailabilityService } from '../availability/availability.service';
import { AppointmentService as AppointmentServiceEntity } from './entities/appointment_service.entity';
import { Service } from '../services/entities/service.entity';
import { AppointmentStatus } from './entities/appointment.entity';
import { Tenant } from '../tenants/entities/tenant.entity';

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

  async create(createAppointmentDto: CreateAppointmentDto) {
    const { serviceIds, ...appointmentData } = createAppointmentDto;

    if (!appointmentData.staffId) {
      throw new BadRequestException('Staff requerido');
    }

    const startTime = this.parseDate(appointmentData.startTime, 'startTime');

    const tenantRepo = this.appointmentRepository.manager.getRepository(Tenant);
    const tenant = await tenantRepo.findOne({
      where: { id: appointmentData.tenantId },
    });
    const timezone = tenant?.timezone ?? 'America/La_Paz';
    const { date, time } = this.getDateTimeParts(startTime, timezone);

    const availability = await this.availabilityService.findAvailableSlots({
      tenantId: appointmentData.tenantId,
      serviceIds,
      desiredDate: date,
      desiredTime: time,
      staffId: appointmentData.staffId,
    });

    if (!availability.isAvailable || availability.suggestedSlots.length === 0) {
      throw new ConflictException({
        message: 'Horario no disponible para este staff',
        suggestedSlots: availability.suggestedSlots,
      });
    }

    const appointment = this.appointmentRepository.create({
      ...appointmentData,
      startTime,
    });
    const saved = await this.appointmentRepository.save(appointment);

    const services = await this.serviceRepository.find({
      where: {
        id: In(serviceIds),
        tenantId: saved.tenantId,
      },
    });

    if (services.length !== serviceIds.length) {
      throw new BadRequestException(
        'Uno o más servicios no existen para este tenant',
      );
    }

    const appointmentServices = services.map((service, index) =>
      this.appointmentServiceRepository.create({
        appointmentId: saved.id,
        serviceId: service.id,
        staffId: saved.staffId,
        startTime: saved.startTime,
        endTime: saved.endTime,
        priceAtBooking: service.price,
        durationAtBooking: service.durationMinutes,
        sequenceOrder: index,
      }),
    );

    if (appointmentServices.length > 0) {
      await this.appointmentServiceRepository.save(appointmentServices);
    }

    return saved;
  }

  async findAllByTenant(
    tenantId: string,
    page = 1,
    limit = 20,
  ): Promise<{
    items: Array<{
      id: string;
      startTime: Date;
      endTime: Date;
      startTimeFormatted: string;
      endTimeFormatted: string;
      status: AppointmentStatus;
      clientName?: string;
      staffName?: string;
      businessName?: string;
      serviceNames: string[];
      totalDuration: number;
      timezone: string;
    }>;
    total: number;
    counts: {
      pending: number;
      booked: number;
      confirmed: number;
      completed: number;
      cancelled: number;
    };
    page: number;
    limit: number;
    hasMore: boolean;
  }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const skip = (safePage - 1) * safeLimit;

    const [appointments, total] = await this.appointmentRepository.findAndCount(
      {
        where: { tenantId },
        relations: {
          client: true,
          staff: true,
          tenant: true,
          services: {
            service: true,
          },
        },
        order: { startTime: 'ASC' },
        skip,
        take: safeLimit,
      },
    );

    const rawCounts = await this.appointmentRepository
      .createQueryBuilder('appointment')
      .select('COUNT(*)', 'total')
      .addSelect(
        `SUM(CASE WHEN appointment.status = :pending THEN 1 ELSE 0 END)`,
        'pending',
      )
      .addSelect(
        `SUM(CASE WHEN appointment.status = :booked THEN 1 ELSE 0 END)`,
        'booked',
      )
      .addSelect(
        `SUM(CASE WHEN appointment.status = :confirmed THEN 1 ELSE 0 END)`,
        'confirmed',
      )
      .addSelect(
        `SUM(CASE WHEN appointment.status = :completed THEN 1 ELSE 0 END)`,
        'completed',
      )
      .addSelect(
        `SUM(CASE WHEN appointment.status = :cancelled THEN 1 ELSE 0 END)`,
        'cancelled',
      )
      .where('appointment.tenantId = :tenantId', { tenantId })
      .setParameters({
        pending: AppointmentStatus.PENDING,
        booked: AppointmentStatus.BOOKED,
        confirmed: AppointmentStatus.CONFIRMED,
        completed: AppointmentStatus.COMPLETED,
        cancelled: AppointmentStatus.CANCELLED,
      })
      .getRawOne<{
        total: string;
        pending: string;
        booked: string;
        confirmed: string;
        completed: string;
        cancelled: string;
      }>();

    const items = appointments.map((a) => {
      const timezone = a.tenant?.timezone ?? 'America/La_Paz';
      const serviceNames = (a.services ?? [])
        .map((s) => s.service?.name)
        .filter((name): name is string => !!name);
      const totalDuration = (a.services ?? []).reduce((sum, s) => {
        return sum + (s.durationAtBooking ?? 0);
      }, 0);
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
        serviceNames,
        totalDuration,
        timezone,
      };
    });

    return {
      items,
      total,
      counts: {
        pending: Number(rawCounts?.pending ?? 0),
        booked: Number(rawCounts?.booked ?? 0),
        confirmed: Number(rawCounts?.confirmed ?? 0),
        completed: Number(rawCounts?.completed ?? 0),
        cancelled: Number(rawCounts?.cancelled ?? 0),
      },
      page: safePage,
      limit: safeLimit,
      hasMore: skip + items.length < total,
    };
  }

  findOneByTenant(id: string, tenantId: string) {
    return this.appointmentRepository.findOne({
      where: { id, tenantId },
      relations: {
        client: true,
        staff: true,
        tenant: true,
        services: {
          service: true,
        },
      },
    });
  }

  async findTodayByTenant(tenantId: string): Promise<{
    items: Array<{
      id: string;
      startTime: Date;
      endTime: Date;
      startTimeFormatted: string;
      endTimeFormatted: string;
      status: AppointmentStatus;
      clientName?: string;
      staffName?: string;
      businessName?: string;
      serviceNames: string[];
      totalDuration: number;
      timezone: string;
    }>;
    total: number;
    counts: {
      pending: number;
      booked: number;
      confirmed: number;
      completed: number;
      cancelled: number;
    };
    revenueTotal: number;
  }> {
    const tenantRepo = this.appointmentRepository.manager.getRepository(Tenant);
    const tenant = await tenantRepo.findOne({ where: { id: tenantId } });
    const timezone = tenant?.timezone ?? 'America/La_Paz';
    const { startUtc, endUtc } = this.getDayRange(timezone, new Date());

    const endInclusive = new Date(endUtc.getTime() - 1);
    const appointments = await this.appointmentRepository.find({
      where: {
        tenantId,
        startTime: Between(startUtc, endInclusive),
      },
      relations: {
        client: true,
        staff: true,
        tenant: true,
        services: {
          service: true,
        },
      },
      order: { startTime: 'ASC' },
    });

    const items = appointments.map((a) => {
      const serviceNames = (a.services ?? [])
        .map((s) => s.service?.name)
        .filter((name): name is string => !!name);
      const totalDuration = (a.services ?? []).reduce((sum, s) => {
        return sum + (s.durationAtBooking ?? 0);
      }, 0);
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
        serviceNames,
        totalDuration,
        timezone,
      };
    });

    const rawCounts = await this.appointmentRepository
      .createQueryBuilder('appointment')
      .select('COUNT(*)', 'total')
      .addSelect(
        `SUM(CASE WHEN appointment.status = :pending THEN 1 ELSE 0 END)`,
        'pending',
      )
      .addSelect(
        `SUM(CASE WHEN appointment.status = :booked THEN 1 ELSE 0 END)`,
        'booked',
      )
      .addSelect(
        `SUM(CASE WHEN appointment.status = :confirmed THEN 1 ELSE 0 END)`,
        'confirmed',
      )
      .addSelect(
        `SUM(CASE WHEN appointment.status = :completed THEN 1 ELSE 0 END)`,
        'completed',
      )
      .addSelect(
        `SUM(CASE WHEN appointment.status = :cancelled THEN 1 ELSE 0 END)`,
        'cancelled',
      )
      .where('appointment.tenantId = :tenantId', { tenantId })
      .andWhere('appointment.startTime >= :startUtc', { startUtc })
      .andWhere('appointment.startTime < :endUtc', { endUtc })
      .setParameters({
        pending: AppointmentStatus.PENDING,
        booked: AppointmentStatus.BOOKED,
        confirmed: AppointmentStatus.CONFIRMED,
        completed: AppointmentStatus.COMPLETED,
        cancelled: AppointmentStatus.CANCELLED,
      })
      .getRawOne<{
        total: string;
        pending: string;
        booked: string;
        confirmed: string;
        completed: string;
        cancelled: string;
      }>();

    const rawRevenue = await this.appointmentServiceRepository
      .createQueryBuilder('appointmentService')
      .select('SUM(appointmentService.priceAtBooking)', 'revenue')
      .innerJoin(
        Appointment,
        'appointment',
        'appointment.id = appointmentService.appointmentId',
      )
      .where('appointment.tenantId = :tenantId', { tenantId })
      .andWhere('appointment.startTime >= :startUtc', { startUtc })
      .andWhere('appointment.startTime < :endUtc', { endUtc })
      .getRawOne<{ revenue: string | null }>();

    return {
      items,
      total: Number(rawCounts?.total ?? items.length),
      counts: {
        pending: Number(rawCounts?.pending ?? 0),
        booked: Number(rawCounts?.booked ?? 0),
        confirmed: Number(rawCounts?.confirmed ?? 0),
        completed: Number(rawCounts?.completed ?? 0),
        cancelled: Number(rawCounts?.cancelled ?? 0),
      },
      revenueTotal: Number(rawRevenue?.revenue ?? 0),
    };
  }

  async findLastByClient(tenantId: string, clientId: string) {
    return this.appointmentRepository.findOne({
      where: {
        tenantId,
        clientId,
        status: AppointmentStatus.CONFIRMED,
      },
      relations: ['services', 'services.service', 'services.staff'],
      order: { startTime: 'DESC' },
    });
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

  async updateFromAssistant(input: {
    appointmentId: string;
    tenantId: string;
    serviceIds: string[];
    staffId?: string;
    date: string;
    time: string;
  }): Promise<Appointment> {
    const appointment = await this.appointmentRepository.findOne({
      where: { id: input.appointmentId },
    });

    if (!appointment) {
      throw new Error('Cita no encontrada');
    }

    const availability = await this.availabilityService.findAvailableSlots({
      tenantId: input.tenantId,
      serviceIds: input.serviceIds,
      desiredDate: input.date,
      desiredTime: input.time,
      staffId: input.staffId,
    });

    if (!availability.isAvailable || availability.suggestedSlots.length === 0) {
      throw new Error('Nuevo horario no disponible');
    }

    const slot = availability.suggestedSlots[0];

    appointment.staffId = slot.staffId;
    appointment.startTime = new Date(slot.startTime);
    appointment.endTime = new Date(slot.endTime);

    await this.appointmentRepository.save(appointment);

    await this.appointmentServiceRepository.delete({
      appointmentId: appointment.id,
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

  async remove(id: string) {
    await this.appointmentRepository.delete(id);
    return { deleted: true };
  }

  async updateByTenant(
    id: string,
    tenantId: string,
    dto: UpdateAppointmentDto,
  ) {
    await this.appointmentRepository.update({ id, tenantId }, dto);

    if (dto.serviceIds && dto.serviceIds.length > 0) {
      const appointment = await this.appointmentRepository.findOne({
        where: { id, tenantId },
      });

      if (appointment) {
        await this.appointmentServiceRepository.delete({ appointmentId: id });
        const services = await this.serviceRepository.find({
          where: {
            id: In(dto.serviceIds),
            tenantId,
          },
        });

        const appointmentServices = services.map((service, index) =>
          this.appointmentServiceRepository.create({
            appointmentId: appointment.id,
            serviceId: service.id,
            staffId: appointment.staffId,
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
      }
    }

    return this.findOneByTenant(id, tenantId);
  }

  async removeByTenant(id: string, tenantId: string) {
    await this.appointmentRepository.delete({ id, tenantId });
    return { deleted: true };
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

  private getDayRange(timezone: string, now: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const year = Number(parts.find((p) => p.type === 'year')?.value ?? '0');
    const month = Number(parts.find((p) => p.type === 'month')?.value ?? '1');
    const day = Number(parts.find((p) => p.type === 'day')?.value ?? '1');

    const startLocalUtcGuess = new Date(
      Date.UTC(year, month - 1, day, 0, 0, 0),
    );
    const startOffset = this.getTimeZoneOffsetMinutes(
      timezone,
      startLocalUtcGuess,
    );
    const startUtc = new Date(
      Date.UTC(year, month - 1, day, 0, 0, 0) - startOffset * 60000,
    );

    const nextDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
    const endOffset = this.getTimeZoneOffsetMinutes(timezone, nextDay);
    const endUtc = new Date(
      Date.UTC(year, month - 1, day + 1, 0, 0, 0) - endOffset * 60000,
    );

    return { startUtc, endUtc };
  }

  private getTimeZoneOffsetMinutes(timezone: string, date: Date): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const tz = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0';
    const match = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!match) return 0;
    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number(match[2] ?? '0');
    const minutes = Number(match[3] ?? '0');
    return sign * (hours * 60 + minutes);
  }

  private getDateTimeParts(date: Date, timezone: string) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const year = parts.find((p) => p.type === 'year')?.value ?? '0000';
    const month = parts.find((p) => p.type === 'month')?.value ?? '01';
    const day = parts.find((p) => p.type === 'day')?.value ?? '01';
    const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';

    return {
      date: `${year}-${month}-${day}`,
      time: `${hour}:${minute}`,
    };
  }

  private parseDate(value: Date | string, field: string): Date {
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} inválido`);
    }
    return parsed;
  }
}
