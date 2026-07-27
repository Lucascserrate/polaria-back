import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, EntityManager, In, Repository } from 'typeorm';

import { Appointment } from './entities/appointment.entity';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AvailabilityService } from '../availability/availability.service';
import { AppointmentService as AppointmentServiceEntity } from './entities/appointment_service.entity';
import { Service } from '../services/entities/service.entity';
import { AppointmentStatus } from './entities/appointment.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Staff } from '../staff/entities/staff.entity';
import type { BookingRejectionReason } from '../availability/utils/availability.types';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Appointment)
    private appointmentRepository: Repository<Appointment>,
    @InjectRepository(AppointmentServiceEntity)
    private appointmentServiceRepository: Repository<AppointmentServiceEntity>,
    @InjectRepository(Service)
    private serviceRepository: Repository<Service>,
    private readonly availabilityService: AvailabilityService,
  ) {}

  async create(createAppointmentDto: CreateAppointmentDto) {
    const { serviceIds, segments, ...appointmentData } = createAppointmentDto;

    const startTime = this.parseDate(appointmentData.startTime, 'startTime');
    const tenantRepo = this.appointmentRepository.manager.getRepository(Tenant);
    const tenant = await tenantRepo.findOne({
      where: { id: appointmentData.tenantId },
    });
    const timezone = tenant?.timezone ?? 'America/La_Paz';
    const { date, time } = this.getDateTimeParts(startTime, timezone);

    const services = await this.loadServices(
      appointmentData.tenantId,
      serviceIds,
    );
    const expectedTotalMinutes = this.calculateTotalDuration(services);
    if (expectedTotalMinutes <= 0) {
      throw new BadRequestException('Duración total inválida');
    }

    const expectedEndTime = new Date(
      startTime.getTime() + expectedTotalMinutes * 60_000,
    );

    const isMultiStaff = Array.isArray(segments) && segments.length > 0;
    if (!appointmentData.staffId && !isMultiStaff) {
      this.logBookingRejection({
        reason: 'INVALID_INPUT_DATA',
        tenantId: appointmentData.tenantId,
        staffId: appointmentData.staffId,
        serviceIds,
        requestedDate: date,
        requestedStartTime: startTime,
        calculatedEndTime: expectedEndTime,
        detail: 'Staff requerido',
      });
      throw new BadRequestException('Staff requerido');
    }

    const temporalRejection = this.getTemporalRejection({
      requestedStartTime: startTime,
      timezone,
    });
    if (temporalRejection) {
      this.logBookingRejection({
        reason: temporalRejection,
        tenantId: appointmentData.tenantId,
        staffId: appointmentData.staffId,
        serviceIds,
        requestedDate: date,
        requestedStartTime: startTime,
        calculatedEndTime: expectedEndTime,
        detail: this.rejectionMessageFor(temporalRejection),
      });
      throw new ConflictException({
        message: this.rejectionMessageFor(temporalRejection),
      });
    }

    const availability = await this.availabilityService.findAvailableSlots({
      tenantId: appointmentData.tenantId,
      serviceIds,
      desiredDate: date,
      desiredTime: time,
      staffId: isMultiStaff ? undefined : appointmentData.staffId,
    });

    if (!availability.isAvailable || availability.suggestedSlots.length === 0) {
      const reason =
        availability.rejectionReason ??
        (isMultiStaff ? 'NO_AVAILABLE_SLOT' : 'STAFF_ALREADY_BUSY');
      this.logBookingRejection({
        reason,
        tenantId: appointmentData.tenantId,
        staffId: appointmentData.staffId,
        serviceIds,
        requestedDate: date,
        requestedStartTime: startTime,
        calculatedEndTime: expectedEndTime,
        detail:
          availability.rejectionMessage ?? this.rejectionMessageFor(reason),
      });
      throw new ConflictException({
        message:
          availability.rejectionMessage ?? this.rejectionMessageFor(reason),
        suggestedSlots: availability.suggestedSlots,
      });
    }

    const slot = availability.suggestedSlots[0];

    return this.createWithValidation({
      tenantId: appointmentData.tenantId,
      clientId: appointmentData.clientId,
      startTime,
      endTime: expectedEndTime,
      status: appointmentData.status ?? AppointmentStatus.PENDING,
      serviceIds,
      staffId: appointmentData.staffId,
      segments: slot.segments,
      orderedServices: services,
    });
  }

  async findAllByTenant(
    tenantId: string,
    page = 1,
    limit = 20,
    filters?: {
      search?: string;
      status?: string;
      sortBy?: 'date-asc' | 'date-desc';
    },
  ): Promise<{
    items: Array<{
      id: string;
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

    let query = this.appointmentRepository
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.tenant', 'tenant')
      .leftJoinAndSelect('appointment.client', 'client')
      .leftJoinAndSelect('appointment.services', 'appointmentServices')
      .leftJoinAndSelect('appointmentServices.service', 'service')
      .leftJoinAndSelect('appointmentServices.staff', 'staff')
      .where('appointment.tenantId = :tenantId', { tenantId });

    if (filters?.search && filters.search.trim()) {
      query = query.andWhere(
        'LOWER(client.name) LIKE LOWER(:search) OR LOWER(staff.name) LIKE LOWER(:search) OR LOWER(service.name) LIKE LOWER(:search)',
        { search: `%${filters.search.trim()}%` },
      );
    }

    if (filters?.status && filters.status !== 'all') {
      query = query.andWhere('appointment.status = :status', {
        status: filters.status,
      });
    }

    const sortField = filters?.sortBy === 'date-desc' ? 'DESC' : 'ASC';
    query = query.orderBy('appointment.startTime', sortField);

    const total = await this.appointmentRepository
      .createQueryBuilder('appointment')
      .where('appointment.tenantId = :tenantId', { tenantId })
      .getCount();

    query = query.skip(skip).take(safeLimit);
    const appointments = await query.getMany();

    const rawCounts = await this.appointmentRepository
      .createQueryBuilder('appointment')
      .select('COUNT(*)', 'total')
      .addSelect(
        `SUM(CASE WHEN appointment.status = :pending THEN 1 ELSE 0 END)`,
        'pending',
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
        confirmed: AppointmentStatus.CONFIRMED,
        completed: AppointmentStatus.COMPLETED,
        cancelled: AppointmentStatus.CANCELLED,
      })
      .getRawOne<{
        total: string;
        pending: string;
        confirmed: string;
        completed: string;
        cancelled: string;
      }>();

    const items = appointments.map((a) => {
      const timezone = a.tenant?.timezone ?? 'America/La_Paz';
      const serviceNames = (a.services ?? [])
        .map((s) => s.service?.name)
        .filter((name): name is string => !!name);
      const totalDuration = this.calculateTotalDurationFromSegments(a.services);
      return {
        id: a.id,
        startTimeFormatted: this.formatDateTime(a.startTime, timezone),
        endTimeFormatted: this.formatDateTime(a.endTime, timezone),
        status: a.status,
        clientName: a.client?.name,
        staffName: this.getStaffLabel(a.services),
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
        tenant: true,
        services: {
          service: true,
          staff: true,
        },
      },
    });
  }

  async findTodayByTenant(tenantId: string): Promise<{
    items: Array<{
      id: string;
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
        tenant: true,
        services: {
          service: true,
          staff: true,
        },
      },
      order: { startTime: 'ASC' },
    });

    const items = appointments.map((a) => {
      const serviceNames = (a.services ?? [])
        .map((s) => s.service?.name)
        .filter((name): name is string => !!name);
      return {
        id: a.id,
        startTimeFormatted: this.formatDateTime(a.startTime, timezone),
        endTimeFormatted: this.formatDateTime(a.endTime, timezone),
        status: a.status,
        clientName: a.client?.name,
        staffName: this.getStaffLabel(a.services),
        businessName: a.tenant?.name,
        serviceNames,
        totalDuration: this.calculateTotalDurationFromSegments(a.services),
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
    const slot = await this.requireAvailableSlot({
      tenantId: input.tenantId,
      serviceIds: input.serviceIds,
      desiredDate: input.date,
      desiredTime: input.time,
      staffId: input.staffId,
      rejectMessage: 'Slot ya no disponible',
      logPrefix: 'assistant booking',
    });

    const services = await this.loadServices(input.tenantId, input.serviceIds);
    const tenantTimezone = await this.getTenantTimezone(input.tenantId);
    const requestedStartTime = new Date(slot.startTime);
    const calculatedEndTime = new Date(slot.endTime);
    const temporalRejection = this.getTemporalRejection({
      requestedStartTime,
      timezone: tenantTimezone,
    });
    if (temporalRejection) {
      this.logBookingRejection({
        reason: temporalRejection,
        tenantId: input.tenantId,
        staffId: slot.staffId,
        serviceIds: input.serviceIds,
        requestedDate: input.date,
        requestedStartTime,
        calculatedEndTime,
        detail: this.rejectionMessageFor(temporalRejection),
      });
      throw new ConflictException({
        message: this.rejectionMessageFor(temporalRejection),
      });
    }
    return this.createWithValidation({
      tenantId: input.tenantId,
      clientId: input.clientId,
      startTime: requestedStartTime,
      endTime: calculatedEndTime,
      status: AppointmentStatus.CONFIRMED,
      serviceIds: input.serviceIds,
      staffId: slot.staffId,
      segments: slot.segments,
      orderedServices: services,
    });
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

    const slot = await this.requireAvailableSlot({
      tenantId: input.tenantId,
      serviceIds: input.serviceIds,
      desiredDate: input.date,
      desiredTime: input.time,
      staffId: input.staffId,
      rejectMessage: 'Nuevo horario no disponible',
      logPrefix: 'assistant update',
    });

    const services = await this.loadServices(input.tenantId, input.serviceIds);

    return this.dataSource.transaction(async (manager) => {
      const lockedAppointmentRepository = manager.getRepository(Appointment);
      const lockedAppointmentServiceRepository = manager.getRepository(
        AppointmentServiceEntity,
      );
      const targetAppointment = await lockedAppointmentRepository.findOne({
        where: { id: input.appointmentId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!targetAppointment) {
        throw new Error('Cita no encontrada');
      }

      const lockedStaffIds = this.extractStaffIds({
        staffId: slot.staffId,
        segments: slot.segments,
      });
      await this.lockStaffRows(manager, input.tenantId, lockedStaffIds);
      await this.throwIfConflicting({
        manager,
        tenantId: input.tenantId,
        staffIds: lockedStaffIds,
        startTime: new Date(slot.startTime),
        endTime: new Date(slot.endTime),
        ignoreAppointmentId: targetAppointment.id,
        rejectMessage: 'Nuevo horario no disponible',
      });

      targetAppointment.startTime = new Date(slot.startTime);
      targetAppointment.endTime = new Date(slot.endTime);
      await lockedAppointmentRepository.save(targetAppointment);
      await lockedAppointmentServiceRepository.delete({
        appointmentId: targetAppointment.id,
      });

      const appointmentServices = this.buildAppointmentServices({
        appointmentId: targetAppointment.id,
        startTime: targetAppointment.startTime,
        services,
        staffId: input.staffId,
        segments: slot.segments,
      });
      if (appointmentServices.length > 0) {
        await lockedAppointmentServiceRepository.save(appointmentServices);
      }

      return targetAppointment;
    });
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
    const { serviceIds, staffId, segments, ...appointmentUpdates } = dto as {
      serviceIds?: string[];
      staffId?: string;
      segments?: Array<{ serviceId: string; staffId: string }>;
      startTime?: Date;
      endTime?: Date;
      status?: AppointmentStatus;
      googleEventId?: string;
      reminderSent?: boolean;
      clientId?: string;
    };

    await this.appointmentRepository.update(
      { id, tenantId },
      appointmentUpdates,
    );

    if (serviceIds && serviceIds.length > 0) {
      const appointment = await this.appointmentRepository.findOne({
        where: { id, tenantId },
      });

      if (appointment) {
        const tenantRepo =
          this.appointmentRepository.manager.getRepository(Tenant);
        const tenant = await tenantRepo.findOne({ where: { id: tenantId } });
        const timezone = tenant?.timezone ?? 'America/La_Paz';
        const { date, time } = this.getDateTimeParts(
          appointment.startTime,
          timezone,
        );

        const isMultiStaff = Array.isArray(segments) && segments.length > 0;
        const availability = await this.availabilityService.findAvailableSlots({
          tenantId,
          serviceIds,
          desiredDate: date,
          desiredTime: time,
          staffId: isMultiStaff ? undefined : staffId,
        });

        if (
          !availability.isAvailable ||
          availability.suggestedSlots.length === 0
        ) {
          throw new ConflictException({
            message: 'Nuevo horario no disponible',
            suggestedSlots: availability.suggestedSlots,
          });
        }

        const slot = availability.suggestedSlots[0];

        await this.appointmentServiceRepository.delete({ appointmentId: id });
        const services = await this.loadServices(tenantId, serviceIds);

        const appointmentServices = this.buildAppointmentServices({
          appointmentId: appointment.id,
          startTime: appointment.startTime,
          services,
          staffId,
          segments: slot.segments,
        });
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

  private async createWithValidation(input: {
    tenantId: string;
    clientId: string;
    startTime: Date;
    endTime: Date;
    status: AppointmentStatus;
    serviceIds: string[];
    staffId?: string;
    segments?: Array<{ serviceId: string; staffId: string }>;
    orderedServices: Service[];
  }): Promise<Appointment> {
    return this.dataSource.transaction(async (manager) => {
      const appointmentRepository = manager.getRepository(Appointment);
      const appointmentServiceRepository = manager.getRepository(
        AppointmentServiceEntity,
      );

      const lockedStaffIds = this.extractStaffIds({
        staffId: input.staffId,
        segments: input.segments,
      });
      await this.lockStaffRows(manager, input.tenantId, lockedStaffIds);
      await this.throwIfConflicting({
        manager,
        tenantId: input.tenantId,
        staffIds: lockedStaffIds,
        startTime: input.startTime,
        endTime: input.endTime,
        rejectMessage:
          input.status === AppointmentStatus.CONFIRMED
            ? 'Horario no disponible para este staff'
            : 'Horario no disponible para este staff',
      });

      const appointment = appointmentRepository.create({
        tenantId: input.tenantId,
        clientId: input.clientId,
        startTime: input.startTime,
        endTime: input.endTime,
        status: input.status,
        reminderSent: false,
      });
      const saved = await appointmentRepository.save(appointment);

      const appointmentServices = this.buildAppointmentServices({
        appointmentId: saved.id,
        startTime: saved.startTime,
        services: input.orderedServices,
        staffId: input.staffId,
        segments: input.segments,
      });
      if (appointmentServices.length > 0) {
        await appointmentServiceRepository.save(appointmentServices);
      }

      return saved;
    });
  }

  private async requireAvailableSlot(input: {
    tenantId: string;
    serviceIds: string[];
    desiredDate: string;
    desiredTime: string;
    staffId?: string;
    rejectMessage: string;
    logPrefix: string;
  }) {
    const availability = await this.availabilityService.findAvailableSlots({
      tenantId: input.tenantId,
      serviceIds: input.serviceIds,
      desiredDate: input.desiredDate,
      desiredTime: input.desiredTime,
      staffId: input.staffId,
    });

    if (!availability.isAvailable || availability.suggestedSlots.length === 0) {
      const reason =
        availability.rejectionReason ??
        (input.staffId ? 'STAFF_ALREADY_BUSY' : 'NO_AVAILABLE_SLOT');
      this.logBookingRejection({
        reason,
        tenantId: input.tenantId,
        staffId: input.staffId,
        serviceIds: input.serviceIds,
        requestedDate: input.desiredDate,
        requestedStartTime: new Date(
          `${input.desiredDate}T${input.desiredTime}:00`,
        ),
        calculatedEndTime: new Date(
          `${input.desiredDate}T${input.desiredTime}:00`,
        ),
        detail:
          availability.rejectionMessage ?? this.rejectionMessageFor(reason),
      });
      throw new ConflictException({
        message: availability.rejectionMessage ?? input.rejectMessage,
        suggestedSlots: availability.suggestedSlots,
      });
    }

    return availability.suggestedSlots[0];
  }

  private async loadServices(tenantId: string, serviceIds: string[]) {
    const services = await this.serviceRepository.find({
      where: {
        id: In(serviceIds),
        tenantId,
        isActive: true,
      },
    });

    if (services.length !== serviceIds.length) {
      throw new BadRequestException(
        'Uno o más servicios no existen para este tenant',
      );
    }

    const servicesById = new Map(services.map((s) => [s.id, s]));
    return serviceIds.map((id) => servicesById.get(id)!);
  }

  private buildAppointmentServices(input: {
    appointmentId: string;
    startTime: Date;
    services: Service[];
    staffId?: string;
    segments?: Array<{ serviceId: string; staffId: string }>;
  }) {
    let cursor = input.startTime;
    return input.services.map((service, index) => {
      const segmentStart = cursor;
      const segmentEnd = new Date(
        segmentStart.getTime() + service.durationMinutes * 60_000,
      );
      cursor = segmentEnd;

      const staffIdForService =
        input.segments?.find((segment) => segment.serviceId === service.id)
          ?.staffId ?? input.staffId;

      if (!staffIdForService) {
        throw new BadRequestException(
          'No se pudo determinar staff para el servicio',
        );
      }

      return this.appointmentServiceRepository.create({
        appointmentId: input.appointmentId,
        serviceId: service.id,
        staffId: staffIdForService,
        startTime: segmentStart,
        endTime: segmentEnd,
        priceAtBooking: service.price,
        durationAtBooking: service.durationMinutes,
        sequenceOrder: index,
      });
    });
  }

  private calculateTotalDuration(services: Service[]) {
    return services.reduce(
      (sum, service) => sum + (service.durationMinutes || 0),
      0,
    );
  }

  private calculateTotalDurationFromSegments(
    segments: Array<{ durationAtBooking?: number }> | undefined,
  ) {
    return (segments ?? []).reduce(
      (sum, segment) => sum + (segment.durationAtBooking ?? 0),
      0,
    );
  }

  private getStaffLabel(
    segments: Array<{ staff?: { name?: string | null } }> | undefined,
  ) {
    const names = (segments ?? [])
      .map((s) => s.staff?.name)
      .filter((name): name is string => !!name);
    const unique = Array.from(new Set(names));
    if (unique.length === 0) return undefined;
    if (unique.length === 1) return unique[0];
    return 'Varios';
  }

  private extractStaffIds(input: {
    staffId?: string;
    segments?: Array<{ serviceId: string; staffId: string }>;
  }) {
    const ids = input.segments?.length
      ? input.segments.map((segment) => segment.staffId)
      : [input.staffId].filter((id): id is string => Boolean(id));
    return Array.from(new Set(ids));
  }

  private async lockStaffRows(
    manager: EntityManager,
    tenantId: string,
    staffIds: string[],
  ) {
    if (staffIds.length === 0) return;
    await manager
      .getRepository(Staff)
      .createQueryBuilder('staff')
      .setLock('pessimistic_write')
      .where('staff.id IN (:...staffIds)', { staffIds })
      .andWhere('staff.tenantId = :tenantId', { tenantId })
      .getMany();
  }

  private async throwIfConflicting(input: {
    manager: EntityManager;
    tenantId: string;
    staffIds: string[];
    startTime: Date;
    endTime: Date;
    ignoreAppointmentId?: string;
    rejectMessage: string;
  }) {
    const {
      manager,
      tenantId,
      staffIds,
      startTime,
      endTime,
      ignoreAppointmentId,
    } = input;
    if (staffIds.length === 0) return;

    const qb = manager
      .getRepository(Appointment)
      .createQueryBuilder('appointment')
      .innerJoin('appointment.services', 'appointmentService')
      .select([
        'appointment.id AS appointmentId',
        'appointment.status AS appointmentStatus',
        'appointment.tenantId AS tenantId',
        'appointment.startTime AS appointmentStartTime',
        'appointment.endTime AS appointmentEndTime',
        'appointmentService.id AS appointmentServiceId',
        'appointmentService.staffId AS staffId',
        'appointmentService.startTime AS serviceStartTime',
        'appointmentService.endTime AS serviceEndTime',
      ])
      .where('appointment.tenantId = :tenantId', { tenantId })
      .andWhere('appointment.status IN (:...statuses)', {
        statuses: [
          AppointmentStatus.PENDING,
          AppointmentStatus.BOOKED,
          AppointmentStatus.CONFIRMED,
        ],
      })
      .andWhere('appointmentService.staffId IN (:...staffIds)', { staffIds })
      .andWhere('appointment.startTime < :endTime', { endTime })
      .andWhere('appointment.endTime > :startTime', { startTime })
      .orderBy('appointment.startTime', 'ASC');

    if (ignoreAppointmentId) {
      qb.andWhere('appointment.id != :ignoreAppointmentId', {
        ignoreAppointmentId,
      });
    }

    const conflicts = await qb.getRawMany<{
      appointmentId: string;
      appointmentStatus: AppointmentStatus;
      tenantId: string;
      appointmentStartTime: Date;
      appointmentEndTime: Date;
      appointmentServiceId: string;
      staffId: string;
      serviceStartTime: Date;
      serviceEndTime: Date;
    }>();

    if (conflicts.length > 0) {
      this.logBookingRejection({
        reason: 'OVERLAPS_ACTIVE_APPOINTMENT',
        tenantId,
        staffId: staffIds.join(','),
        serviceIds: [],
        requestedDate: '',
        requestedStartTime: startTime,
        calculatedEndTime: endTime,
        detail: `Conflicting appointment ${conflicts[0].appointmentId}`,
      });
      const conflict = conflicts[0];
      throw new ConflictException({
        message: input.rejectMessage,
        conflict: {
          appointmentId: conflict.appointmentId,
          staffId: conflict.staffId,
          startTime: new Date(conflict.appointmentStartTime),
          endTime: new Date(conflict.appointmentEndTime),
          status: conflict.appointmentStatus,
        },
      });
    }
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
  private async getTenantTimezone(tenantId: string) {
    const tenantRepo = this.appointmentRepository.manager.getRepository(Tenant);
    const tenant = await tenantRepo.findOne({ where: { id: tenantId } });
    return tenant?.timezone ?? 'America/La_Paz';
  }

  private getTemporalRejection(input: {
    requestedStartTime: Date;
    timezone: string;
  }): BookingRejectionReason | undefined {
    void input.timezone;
    if (Number.isNaN(input.requestedStartTime.getTime())) {
      return 'INVALID_INPUT_DATA';
    }
    if (input.requestedStartTime < new Date()) {
      return 'PAST_DATE';
    }
    return undefined;
  }

  private rejectionMessageFor(reason: BookingRejectionReason): string {
    const messages: Record<BookingRejectionReason, string> = {
      INVALID_TENANT: 'Tenant inválido',
      INVALID_INPUT_DATA: 'Datos de reserva inválidos',
      PAST_DATE: 'La fecha solicitada ya pasó',
      PAST_TIME: 'La hora solicitada ya pasó',
      STAFF_NOT_FOUND: 'No existe un staff válido para esa reserva',
      SERVICES_NOT_FOUND: 'Uno o más servicios no existen para ese tenant',
      STAFF_CANNOT_PERFORM_SERVICE:
        'El staff no puede realizar uno o más servicios solicitados',
      OUTSIDE_BUSINESS_HOURS: 'La cita está fuera del horario de atención',
      STARTS_BEFORE_OPENING_HOURS:
        'La cita empieza antes de la hora de apertura',
      ENDS_AFTER_CLOSING_HOURS: 'La cita termina después de la hora de cierre',
      REQUESTED_DURATION_EXCEEDS_WORKING_TIME:
        'La duración solicitada excede el tiempo disponible',
      NO_AVAILABLE_SLOT: 'No hay disponibilidad para ese horario',
      STAFF_ALREADY_BUSY: 'El staff ya está ocupado en ese horario',
      OVERLAPS_ACTIVE_APPOINTMENT: 'La cita se superpone con otra cita activa',
      SLOT_NO_LONGER_AVAILABLE:
        'El horario ya no está disponible porque otra reserva lo ocupó',
      UNKNOWN_BUSINESS_RULE:
        'La reserva fue rechazada por una regla de negocio',
    };
    return messages[reason];
  }

  private logBookingRejection(input: {
    reason: BookingRejectionReason;
    tenantId: string;
    staffId?: string;
    serviceIds: string[];
    requestedDate: string;
    requestedStartTime: Date;
    calculatedEndTime: Date;
    detail: string;
  }) {
    void input;
  }
}
