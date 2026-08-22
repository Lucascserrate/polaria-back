import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, MoreThanOrEqual, Repository } from 'typeorm';

import {
  Appointment,
  blocksAgenda,
  BLOCKING_APPOINTMENT_STATUSES,
  OPEN_APPOINTMENT_STATUSES,
} from './entities/appointment.entity';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { EditBookingDto } from './dto/edit-booking.dto';
import { planBookingSegments } from './booking-plan';
import { AvailabilityService } from '../availability/availability.service';
import { BookingAvailabilityService } from '../availability/booking/booking-availability.service';
import { AppointmentService as AppointmentServiceEntity } from './entities/appointment_service.entity';
import { Service } from '../services/entities/service.entity';
import { AppointmentStatus } from './entities/appointment.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import {
  isDuplicateEntryError,
  SlotAlreadyTakenError,
} from './slot-already-taken.error';
import {
  toAppointmentDetail,
  toAppointmentItem,
  type AppointmentDetail,
  type AppointmentItem,
} from './appointment-item';
import {
  currentCalendarDate,
  dayWindow,
  daysInRange,
  parseCalendarDate,
  rangeWindow,
  type CalendarDate,
} from './appointment-window';

const DEFAULT_TIMEZONE = 'America/La_Paz';

/**
 * Tope de días que puede pedir una sola consulta de rango.
 *
 * La agenda pide siete. El límite está para que un `from`/`to` mal armado no
 * termine trayendo un año entero de citas con todas sus relaciones.
 */
const MAX_RANGE_DAYS = 62;

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
    private readonly bookingAvailabilityService: BookingAvailabilityService,
  ) {}

  async create(createAppointmentDto: CreateAppointmentDto) {
    const { serviceIds, segments, ...appointmentData } = createAppointmentDto;

    const startTime = this.parseDate(appointmentData.startTime, 'startTime');
    const endTimeInput = this.parseDate(appointmentData.endTime, 'endTime');

    const tenantRepo = this.appointmentRepository.manager.getRepository(Tenant);
    const tenant = await tenantRepo.findOne({
      where: { id: appointmentData.tenantId },
    });
    const timezone = tenant?.timezone ?? DEFAULT_TIMEZONE;
    const { date, time } = this.getDateTimeParts(startTime, timezone);

    const services = await this.serviceRepository.find({
      where: {
        id: In(serviceIds),
        tenantId: appointmentData.tenantId,
        isActive: true,
      },
    });

    if (services.length !== serviceIds.length) {
      throw new BadRequestException(
        'Uno o más servicios no existen para este tenant',
      );
    }

    const servicesById = new Map(services.map((s) => [s.id, s]));
    const orderedServices = serviceIds.map((id) => servicesById.get(id)!);

    const expectedTotalMinutes = orderedServices.reduce(
      (sum, s) => sum + (s.durationMinutes || 0),
      0,
    );
    if (expectedTotalMinutes <= 0) {
      throw new BadRequestException('Duración total inválida');
    }

    const expectedEndTime = new Date(
      startTime.getTime() + expectedTotalMinutes * 60_000,
    );
    const diffMs = Math.abs(expectedEndTime.getTime() - endTimeInput.getTime());
    if (diffMs > 60_000) {
      throw new BadRequestException(
        'endTime no coincide con la duración total de los servicios',
      );
    }

    const isMultiStaff = Array.isArray(segments) && segments.length > 0;
    if (!appointmentData.staffId && !isMultiStaff) {
      throw new BadRequestException('Staff requerido');
    }

    const availability = await this.availabilityService.findAvailableSlots({
      tenantId: appointmentData.tenantId,
      serviceIds,
      desiredDate: date,
      desiredTime: time,
      staffId: isMultiStaff ? undefined : appointmentData.staffId,
    });

    if (!availability.isAvailable || availability.suggestedSlots.length === 0) {
      throw new ConflictException({
        message: isMultiStaff
          ? 'Horario no disponible para los servicios solicitados'
          : 'Horario no disponible para este staff',
        suggestedSlots: availability.suggestedSlots,
      });
    }

    const chosen = availability.suggestedSlots[0];
    const derivedSegments = chosen.segments;

    const appointment = this.appointmentRepository.create({
      ...appointmentData,
      startTime,
      endTime: expectedEndTime,
    });
    const saved = await this.appointmentRepository.save(appointment);

    let cursor = saved.startTime;
    const appointmentServices = orderedServices.map((service, index) => {
      const segmentStart = cursor;
      const segmentEnd = new Date(
        segmentStart.getTime() + service.durationMinutes * 60_000,
      );
      cursor = segmentEnd;

      const staffIdForService =
        derivedSegments?.find((s) => s.serviceId === service.id)?.staffId ??
        appointmentData.staffId;

      if (!staffIdForService) {
        throw new BadRequestException(
          'No se pudo determinar staff para el servicio',
        );
      }

      return this.appointmentServiceRepository.create({
        appointmentId: saved.id,
        serviceId: service.id,
        staffId: staffIdForService,
        startTime: segmentStart,
        activeStartTime: blocksAgenda(saved.status) ? segmentStart : null,
        endTime: segmentEnd,
        priceAtBooking: service.price,
        durationAtBooking: service.durationMinutes,
        sequenceOrder: index,
      });
    });

    if (appointmentServices.length > 0) {
      await this.saveSegments(appointmentServices, saved.id);
    }

    return saved;
  }

  /**
   * Persiste segmentos traduciendo el fallo del índice único a un conflicto
   * explicable. `rollbackAppointmentId` borra la cita huérfana cuando la carrera
   * se pierde: sin eso quedaría una cita sin segmentos.
   */
  private async saveSegments(
    segments: AppointmentServiceEntity[],
    rollbackAppointmentId?: string,
  ): Promise<void> {
    try {
      await this.appointmentServiceRepository.save(segments);
    } catch (error: unknown) {
      if (rollbackAppointmentId) {
        await this.appointmentRepository.delete({ id: rollbackAppointmentId });
      }
      if (isDuplicateEntryError(error)) {
        const first = segments[0];
        throw new ConflictException(
          new SlotAlreadyTakenError(first.staffId, first.startTime).message,
        );
      }
      throw error;
    }
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
    items: AppointmentItem[];
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
      // Sin esto el join descartaría al staff dado de baja y las citas viejas
      // aparecerían sin profesional. Solo afecta a `staff`: es la única entidad
      // de esta consulta con borrado lógico.
      .withDeleted()
      .where('appointment.tenantId = :tenantId', { tenantId: tenantId });

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

    const totalQuery = this.appointmentRepository
      .createQueryBuilder('appointment')
      .where('appointment.tenantId = :tenantId', { tenantId: tenantId });
    const total = await totalQuery.getCount();

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

    const items = appointments.map((a) =>
      toAppointmentItem(a, a.tenant?.timezone ?? DEFAULT_TIMEZONE),
    );

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

  /**
   * La reserva completa, mapeada, para el panel.
   *
   * Aparte de `findOneByTenant`, que devuelve la entidad cruda y la usan los
   * flujos internos: esa arrastra la relación `tenant` con el token de WhatsApp
   * adentro, y eso no puede viajar al navegador.
   */
  async findDetailByTenant(
    id: string,
    tenantId: string,
  ): Promise<AppointmentDetail> {
    const appointment = await this.appointmentRepository.findOne({
      where: { id, tenantId },
      relations: {
        client: true,
        tenant: true,
        reminders: true,
        services: { service: true, staff: true },
      },
      // Conserva el profesional aunque haya sido dado de baja: la reserva ya
      // existe y su historial no debe perder el dato.
      withDeleted: true,
    });

    if (!appointment) {
      throw new NotFoundException('La cita no existe');
    }

    return toAppointmentDetail(
      appointment,
      appointment.tenant?.timezone ?? DEFAULT_TIMEZONE,
    );
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
      // Conserva el profesional aunque haya sido dado de baja: la cita ya
      // ocurrió y su historial no debe perder el dato.
      withDeleted: true,
    });
  }

  /**
   * Las citas de varios días seguidos, para la agenda semanal.
   *
   * No devuelve totales ni ingresos: la agenda dibuja una grilla, y sumar por
   * día sería trabajo que nadie mira. Tampoco recorta por estado —una cancelada
   * ocupa lugar en el calendario igual que el resto— ni por profesional: eso lo
   * decide la vista con `segments`.
   */
  async findRangeByTenant(
    tenantId: string,
    from: string,
    to: string,
  ): Promise<{
    items: AppointmentItem[];
    from: string;
    to: string;
    timezone: string;
  }> {
    const tenantRepo = this.appointmentRepository.manager.getRepository(Tenant);
    const tenant = await tenantRepo.findOne({ where: { id: tenantId } });
    const timezone = tenant?.timezone ?? DEFAULT_TIMEZONE;

    const { startUtc, endUtc } = this.resolveRangeWindow(timezone, from, to);

    /*
     * El filtro es por inicio, igual que la consulta del día: una cita que
     * empieza antes del rango y termina dentro queda afuera. Con jornadas que
     * cierran antes de medianoche eso no puede pasar, y filtrar por
     * solapamiento obligaría a un OR que no aprovecha el índice.
     */
    const appointments = await this.appointmentRepository.find({
      where: {
        tenantId,
        startTime: Between(startUtc, new Date(endUtc.getTime() - 1)),
      },
      relations: {
        client: true,
        tenant: true,
        reminders: true,
        services: {
          service: true,
          staff: true,
        },
      },
      // Sin esto las citas de un profesional dado de baja aparecerían sin
      // profesional, y en la vista por columnas no tendrían dónde ir.
      withDeleted: true,
      order: { startTime: 'ASC' },
    });

    return {
      items: appointments.map((a) => toAppointmentItem(a, timezone)),
      from,
      to,
      timezone,
    };
  }

  /**
   * La agenda de un día completo del negocio, con sus totales.
   *
   * `date` ausente significa hoy, que es lo que abre el panel; con una fecha se
   * mira otro día del calendario sin cambiar nada más de la respuesta.
   */
  async findDayByTenant(
    tenantId: string,
    date?: string,
  ): Promise<{
    items: AppointmentItem[];
    total: number;
    counts: {
      pending: number;
      confirmed: number;
      completed: number;
      cancelled: number;
    };
    revenueTotal: number;
  }> {
    const tenantRepo = this.appointmentRepository.manager.getRepository(Tenant);
    const tenant = await tenantRepo.findOne({ where: { id: tenantId } });
    const timezone = tenant?.timezone ?? DEFAULT_TIMEZONE;
    const { startUtc, endUtc } = this.resolveDayRange(timezone, date);

    const endInclusive = new Date(endUtc.getTime() - 1);
    const appointments = await this.appointmentRepository.find({
      where: {
        tenantId,
        startTime: Between(startUtc, endInclusive),
      },
      relations: {
        client: true,
        tenant: true,
        reminders: true,
        services: {
          service: true,
          staff: true,
        },
      },
      withDeleted: true,
      order: { startTime: 'ASC' },
    });

    const items = appointments.map((a) => toAppointmentItem(a, timezone));

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
      .andWhere('appointment.startTime >= :startUtc', { startUtc })
      .andWhere('appointment.startTime < :endUtc', { endUtc })
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

    // Solo lo atendido, igual que el módulo de reportes. Sin este filtro sumaba
    // también las canceladas y las que todavía no ocurrieron, y el mismo día
    // mostraba dos cifras distintas según qué pantalla lo preguntara.
    const rawRevenue = await this.appointmentServiceRepository
      .createQueryBuilder('appointmentService')
      .select('SUM(appointmentService.priceAtBooking)', 'revenue')
      .innerJoin(
        Appointment,
        'appointment',
        'appointment.id = appointmentService.appointmentId',
      )
      .where('appointment.tenantId = :tenantId', { tenantId })
      .andWhere('appointment.status = :completed', {
        completed: AppointmentStatus.COMPLETED,
      })
      .andWhere('appointment.startTime >= :startUtc', { startUtc })
      .andWhere('appointment.startTime < :endUtc', { endUtc })
      .getRawOne<{ revenue: string | null }>();

    return {
      items,
      total: Number(rawCounts?.total ?? items.length),
      counts: {
        pending: Number(rawCounts?.pending ?? 0),
        confirmed: Number(rawCounts?.confirmed ?? 0),
        completed: Number(rawCounts?.completed ?? 0),
        cancelled: Number(rawCounts?.cancelled ?? 0),
      },
      revenueTotal: Number(rawRevenue?.revenue ?? 0),
    };
  }

  /**
   * Citas futuras de un cliente, la más próxima primero.
   *
   * Solo las que ocupan agenda: una cancelada o completada no es algo que el
   * cliente pueda reagendar. El corte es por hora de inicio, así que un turno en
   * curso ya no aparece.
   */
  findUpcomingByClient(params: {
    tenantId: string;
    clientId: string;
    now?: Date;
    limit?: number;
  }): Promise<Appointment[]> {
    return this.appointmentRepository.find({
      where: {
        tenantId: params.tenantId,
        clientId: params.clientId,
        status: In([...BLOCKING_APPOINTMENT_STATUSES]),
        startTime: MoreThanOrEqual(params.now ?? new Date()),
      },
      relations: { services: { service: true, staff: true } },
      // Sin esto, el profesional dado de baja entra como `NULL` y el cliente ve
      // su turno sin profesional asignado.
      withDeleted: true,
      order: { startTime: 'ASC' },
      take: params.limit,
    });
  }

  findUpcomingByClientAndId(params: {
    tenantId: string;
    clientId: string;
    appointmentId: string;
  }): Promise<Appointment | null> {
    return this.appointmentRepository.findOne({
      where: {
        id: params.appointmentId,
        tenantId: params.tenantId,
        clientId: params.clientId,
      },
      relations: { services: { service: true, staff: true } },
      // Sin esto, el profesional dado de baja entra como `NULL` y el cliente ve
      // su turno sin profesional asignado.
      withDeleted: true,
    });
  }

  /**
   * Cancelación pedida por el cliente.
   *
   * Libera el horario para otro cliente vía `syncActiveSlot`, que es lo que anula
   * `activeStartTime` y saca la fila de la disputa por el índice único.
   *
   * Comprueba que la cita sea de ese cliente y de ese tenant: el id viaja en un
   * componente de WhatsApp y no alcanza con que esté bien formado.
   */
  async cancelByClient(params: {
    tenantId: string;
    clientId: string;
    appointmentId: string;
  }): Promise<Appointment | null> {
    const appointment = await this.findUpcomingByClientAndId(params);
    if (!appointment) return null;

    if (!blocksAgenda(appointment.status)) return appointment;

    appointment.status = AppointmentStatus.CANCELLED;
    await this.appointmentRepository.save(appointment);
    await this.syncActiveSlot(appointment.id, AppointmentStatus.CANCELLED);

    return appointment;
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
      clientId: input.clientId,
      startTime: new Date(slot.startTime),
      endTime: new Date(slot.endTime),
      status: AppointmentStatus.CONFIRMED,
    });

    const services = await this.serviceRepository.find({
      where: {
        id: In(input.serviceIds),
        tenantId: input.tenantId,
        isActive: true,
      },
    });

    const servicesById = new Map(services.map((s) => [s.id, s]));
    const orderedServices = input.serviceIds.map((id) => servicesById.get(id)!);

    let cursor = appointment.startTime;
    const appointmentServices = orderedServices.map((service, index) => {
      const segmentStart = cursor;
      const segmentEnd = new Date(
        segmentStart.getTime() + service.durationMinutes * 60_000,
      );
      cursor = segmentEnd;

      const staffIdForService =
        slot.segments?.find((s) => s.serviceId === service.id)?.staffId ??
        slot.staffId;

      return this.appointmentServiceRepository.create({
        appointmentId: appointment.id,
        serviceId: service.id,
        staffId: staffIdForService,
        startTime: segmentStart,
        activeStartTime: blocksAgenda(appointment.status) ? segmentStart : null,
        endTime: segmentEnd,
        priceAtBooking: service.price,
        durationAtBooking: service.durationMinutes,
        sequenceOrder: index,
      });
    });

    if (appointmentServices.length > 0) {
      await this.saveSegments(appointmentServices, appointment.id);
    }

    return appointment;
  }

  /**
   * Crea la reserva del flujo guiado.
   *
   * A diferencia de `createFromAssistant`, no vuelve a consultar disponibilidad:
   * el horario y el profesional ya fueron revalidados por
   * `BookingAvailabilityService.confirmSlot` inmediatamente antes. Repetir el
   * cálculo acá, además de redundante, reintroduciría el suggester legado con sus
   * criterios cosméticos.
   *
   * Un servicio por reserva, y por lo tanto un único segmento.
   */
  async createFromBookingFlow(input: {
    tenantId: string;
    clientId: string;
    serviceId: string;
    staffId: string;
    startTime: Date;
    endTime: Date;
  }): Promise<Appointment> {
    const service = await this.serviceRepository.findOne({
      where: {
        id: input.serviceId,
        tenantId: input.tenantId,
        isActive: true,
      },
    });

    if (!service) {
      throw new BadRequestException(
        'El servicio no existe o no está activo para este tenant',
      );
    }

    const appointment = await this.appointmentRepository.save(
      this.appointmentRepository.create({
        tenantId: input.tenantId,
        clientId: input.clientId,
        startTime: input.startTime,
        endTime: input.endTime,
        status: AppointmentStatus.CONFIRMED,
      }),
    );

    try {
      await this.appointmentServiceRepository.save(
        this.appointmentServiceRepository.create({
          appointmentId: appointment.id,
          serviceId: service.id,
          staffId: input.staffId,
          startTime: input.startTime,
          activeStartTime: input.startTime,
          endTime: input.endTime,
          priceAtBooking: service.price,
          durationAtBooking: service.durationMinutes,
          sequenceOrder: 0,
        }),
      );
    } catch (error: unknown) {
      // El índice único rechazó el segmento: otro cliente ganó la carrera entre la
      // revalidación y esta inserción. Se deshace la cita huérfana y se informa
      // como horario ocupado.
      await this.appointmentRepository.delete({ id: appointment.id });

      if (isDuplicateEntryError(error)) {
        throw new SlotAlreadyTakenError(input.staffId, input.startTime);
      }
      throw error;
    }

    return appointment;
  }

  /**
   * Mantiene `activeStartTime` en línea con el estado de la cita.
   *
   * Cancelar libera el horario anulando la columna; reactivar lo vuelve a reclamar
   * y puede chocar con el índice único, que es el comportamiento correcto: si
   * alguien más tomó ese horario mientras la cita estaba cancelada, no se puede
   * revivir sin más.
   */
  private async syncActiveSlot(
    appointmentId: string,
    status: AppointmentStatus | undefined,
  ): Promise<void> {
    if (!status) return;

    const releasesSlot = !blocksAgenda(status);

    const segments = await this.appointmentServiceRepository.find({
      where: { appointmentId },
    });
    if (segments.length === 0) return;

    for (const segment of segments) {
      segment.activeStartTime = releasesSlot ? null : segment.startTime;
    }

    try {
      await this.appointmentServiceRepository.save(segments);
    } catch (error: unknown) {
      if (isDuplicateEntryError(error)) {
        const first = segments[0];
        throw new ConflictException(
          new SlotAlreadyTakenError(first.staffId, first.startTime).message,
        );
      }
      throw error;
    }
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
        isActive: true,
      },
    });

    const servicesById = new Map(services.map((s) => [s.id, s]));
    const orderedServices = input.serviceIds.map((id) => servicesById.get(id)!);

    let cursor = appointment.startTime;
    const appointmentServices = orderedServices.map((service, index) => {
      const segmentStart = cursor;
      const segmentEnd = new Date(
        segmentStart.getTime() + service.durationMinutes * 60_000,
      );
      cursor = segmentEnd;

      const staffIdForService =
        slot.segments?.find((s) => s.serviceId === service.id)?.staffId ??
        slot.staffId;

      return this.appointmentServiceRepository.create({
        appointmentId: appointment.id,
        serviceId: service.id,
        staffId: staffIdForService,
        startTime: segmentStart,
        activeStartTime: blocksAgenda(appointment.status) ? segmentStart : null,
        endTime: segmentEnd,
        priceAtBooking: service.price,
        durationAtBooking: service.durationMinutes,
        sequenceOrder: index,
      });
    });

    if (appointmentServices.length > 0) {
      await this.saveSegments(appointmentServices);
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
    const { serviceIds, staffId, segments, ...appointmentUpdates } = dto as {
      serviceIds?: string[];
      staffId?: string;
      segments?: Array<{ serviceId: string; staffId: string }>;
      startTime?: Date;
      endTime?: Date;
      status?: AppointmentStatus;
      googleEventId?: string;
      clientId?: string;
    };

    await this.appointmentRepository.update(
      { id, tenantId },
      appointmentUpdates,
    );

    // Un cambio de estado libera o reclama el horario en el índice único.
    await this.syncActiveSlot(id, appointmentUpdates.status);

    if (serviceIds && serviceIds.length > 0) {
      const appointment = await this.appointmentRepository.findOne({
        where: { id, tenantId },
      });

      if (appointment) {
        const tenantRepo =
          this.appointmentRepository.manager.getRepository(Tenant);
        const tenant = await tenantRepo.findOne({ where: { id: tenantId } });
        const timezone = tenant?.timezone ?? DEFAULT_TIMEZONE;
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
        const services = await this.serviceRepository.find({
          where: {
            id: In(serviceIds),
            tenantId,
            isActive: true,
          },
        });

        const servicesById = new Map(services.map((s) => [s.id, s]));
        const orderedServices = serviceIds.map((sid) => servicesById.get(sid)!);

        let cursor = appointment.startTime;
        const appointmentServices = orderedServices.map((service, index) => {
          const segmentStart = cursor;
          const segmentEnd = new Date(
            segmentStart.getTime() + service.durationMinutes * 60_000,
          );
          cursor = segmentEnd;

          const staffIdForService =
            slot.segments?.find((s) => s.serviceId === service.id)?.staffId ??
            staffId;

          if (!staffIdForService) {
            throw new BadRequestException(
              'No se pudo determinar staff para el servicio',
            );
          }

          return this.appointmentServiceRepository.create({
            appointmentId: appointment.id,
            serviceId: service.id,
            staffId: staffIdForService,
            startTime: segmentStart,
            activeStartTime: blocksAgenda(appointment.status)
              ? segmentStart
              : null,
            endTime: segmentEnd,
            priceAtBooking: service.price,
            durationAtBooking: service.durationMinutes,
            sequenceOrder: index,
          });
        });

        if (appointmentServices.length > 0) {
          await this.saveSegments(appointmentServices);
        }
      }
    }

    return this.findOneByTenant(id, tenantId);
  }

  /**
   * Edita una reserva existente **en el lugar**.
   *
   * Conserva el `appointmentId`, su historial y sus relaciones: no crea una
   * reserva nueva ni cancela la anterior. Eso importa porque el cliente ya tiene
   * esa cita —le llegó su confirmación y su recordatorio cuelga de ella— y
   * partirla en dos dejaría dos verdades.
   *
   * Recibe el estado deseado completo de lo editable: cuándo empieza y qué
   * servicios tiene, cada uno con su profesional. Todo lo demás no se toca.
   *
   * La disponibilidad la decide el mismo motor que usan WhatsApp y el asistente
   * de creación, con una sola diferencia: **esta cita no cuenta como ocupada**.
   * Sin eso, corregir la hora de 09:00 a 09:15 chocaría contra sí misma. No hay
   * forma de forzar un horario cerrado o pisado: si el motor no lo ofrece, no se
   * guarda.
   *
   * Los recordatorios no se tocan acá. La reconciliación corre cada cinco
   * minutos, recalcula el aviso desde el inicio de la cita y mueve el que
   * corresponda; uno ya enviado se queda enviado, que es la verdad.
   */
  async editBookingByTenant(
    id: string,
    tenantId: string,
    dto: EditBookingDto,
  ): Promise<AppointmentDetail> {
    const appointment = await this.appointmentRepository.findOne({
      where: { id, tenantId },
      relations: { services: true },
    });

    if (!appointment) {
      throw new NotFoundException('La cita no existe');
    }

    if (!OPEN_APPOINTMENT_STATUSES.includes(appointment.status)) {
      throw new ConflictException(
        'Solo se pueden editar citas pendientes o confirmadas',
      );
    }

    const startTime = this.parseDate(dto.startTime, 'startTime');

    const tenantRepo = this.appointmentRepository.manager.getRepository(Tenant);
    const tenant = await tenantRepo.findOne({ where: { id: tenantId } });
    const timezone = tenant?.timezone ?? DEFAULT_TIMEZONE;

    const serviceIds = [...new Set(dto.items.map((item) => item.serviceId))];
    const services = await this.serviceRepository.find({
      where: { id: In(serviceIds), tenantId, isActive: true },
    });

    const plan = planBookingSegments({
      startTime,
      items: dto.items,
      services: new Map(
        services.map((service) => [
          service.id,
          {
            durationMinutes: service.durationMinutes,
            price: Number(service.price),
          },
        ]),
      ),
      // Lo que la reserva ya tenía entra con su precio pactado; ver `booking-plan`.
      agreedPrices: new Map(
        (appointment.services ?? []).map((segment) => [
          segment.serviceId,
          Number(segment.priceAtBooking),
        ]),
      ),
    });

    if (!plan.ok) {
      throw new BadRequestException(
        `Servicio inexistente o inactivo: ${plan.missingServiceIds.join(', ')}`,
      );
    }

    /*
     * Cada tramo se revalida por separado, con su propio servicio y profesional.
     * Es lo que permite que el corte lo haga uno y la barba otro sin inventar
     * reglas nuevas: el motor ya sabe si esa persona hace ese servicio, si le
     * toca trabajar y si tiene el horario libre.
     */
    for (const segment of plan.segments) {
      const { date } = this.getDateTimeParts(segment.startTime, timezone);

      const confirmation = await this.bookingAvailabilityService.confirmSlot({
        tenantId,
        date,
        serviceId: segment.serviceId,
        staffId: segment.staffId,
        startTime: segment.startTime,
        excludeAppointmentId: id,
      });

      if (!confirmation.available) {
        const { time } = this.getDateTimeParts(segment.startTime, timezone);
        throw new ConflictException(
          `Las ${time} no están disponibles para ese servicio con ese profesional`,
        );
      }
    }

    const claimsSlot = blocksAgenda(appointment.status);

    /*
     * Los tramos se reemplazan dentro de una transacción. Borrarlos e insertarlos
     * sueltos deja la cita sin tramos si el insert falla —por ejemplo contra el
     * índice único—, y una cita sin tramos no tiene profesional, ni precio, ni
     * lugar en la agenda.
     */
    try {
      await this.replaceSegments({ id, tenantId, plan, claimsSlot, startTime });
    } catch (error: unknown) {
      /*
       * El índice único es la última barrera: entre la revalidación y el insert,
       * WhatsApp pudo tomar ese horario. Se responde igual que un horario
       * ocupado, no como una falla del servidor.
       */
      if (isDuplicateEntryError(error)) {
        throw new ConflictException(
          'Ese horario acaba de ocuparse. Elegí otro.',
        );
      }
      throw error;
    }

    return this.findDetailByTenant(id, tenantId);
  }

  /**
   * Reemplaza los tramos de una reserva y corre su horario, todo o nada.
   *
   * Borrarlos e insertarlos sueltos deja la cita sin tramos si el insert falla
   * —por ejemplo contra el índice único—, y una cita sin tramos no tiene
   * profesional, ni precio, ni lugar en la agenda.
   */
  private async replaceSegments(input: {
    id: string;
    tenantId: string;
    plan: Extract<ReturnType<typeof planBookingSegments>, { ok: true }>;
    claimsSlot: boolean;
    startTime: Date;
  }): Promise<void> {
    const { id, tenantId, plan, claimsSlot, startTime } = input;

    await this.appointmentRepository.manager.transaction(async (manager) => {
      await manager.delete(AppointmentServiceEntity, { appointmentId: id });

      const segments = plan.segments.map((segment) =>
        manager.create(AppointmentServiceEntity, {
          appointmentId: id,
          serviceId: segment.serviceId,
          staffId: segment.staffId,
          startTime: segment.startTime,
          endTime: segment.endTime,
          // Es la columna del índice único: la última barrera contra que dos
          // reservas tomen el mismo horario del mismo profesional.
          activeStartTime: claimsSlot ? segment.startTime : null,
          priceAtBooking: segment.price,
          durationAtBooking: segment.durationMinutes,
          sequenceOrder: segment.sequenceOrder,
        }),
      );

      await manager.save(segments);

      await manager.update(
        Appointment,
        { id, tenantId },
        { startTime, endTime: plan.endTime },
      );
    });
  }

  async removeByTenant(id: string, tenantId: string) {
    await this.appointmentRepository.delete({ id, tenantId });
    return { deleted: true };
  }

  /**
   * Rango del día pedido, o del día en curso si no vino ninguno.
   *
   * El cálculo vive en `appointment-window`; acá solo se traduce una fecha
   * inválida al error que corresponde devolver por HTTP.
   */
  private resolveDayRange(timezone: string, date?: string) {
    if (!date) {
      return dayWindow(timezone, currentCalendarDate(timezone, new Date()));
    }

    return dayWindow(timezone, this.parseDateOrFail(date, 'date'));
  }

  /**
   * Rango de varios días seguidos, con los dos extremos incluidos.
   *
   * El tope de días no es una regla de negocio: es lo que evita que un `from` y
   * un `to` mal armados traigan medio historial del negocio con todas sus
   * relaciones en una sola consulta.
   */
  private resolveRangeWindow(timezone: string, from: string, to: string) {
    const start = this.parseDateOrFail(from, 'from');
    const end = this.parseDateOrFail(to, 'to');

    const days = daysInRange(start, end);
    if (days === 0) {
      throw new BadRequestException('to no puede ser anterior a from');
    }
    if (days > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `El rango no puede superar ${MAX_RANGE_DAYS} días`,
      );
    }

    return rangeWindow(timezone, start, end);
  }

  private parseDateOrFail(value: string, field: string): CalendarDate {
    const parsed = parseCalendarDate(value);
    if (!parsed) {
      throw new BadRequestException(
        `${field} debe ser una fecha real con formato YYYY-MM-DD`,
      );
    }

    return parsed;
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
      throw new BadRequestException(`${field} invÃ¡lido`);
    }
    return parsed;
  }
}
