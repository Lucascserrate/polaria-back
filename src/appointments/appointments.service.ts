import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
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
import { UpdateAppointmentStatusDto } from './dto/update-appointment-status.dto';
import { EditBookingDto } from './dto/edit-booking.dto';
import { planBookingSegments } from './booking-plan';
import { BookingAvailabilityService } from '../availability/booking/booking-availability.service';
import { AppointmentService as AppointmentServiceEntity } from './entities/appointment_service.entity';
import { Service } from '../services/entities/service.entity';
import { AppointmentStatus } from './entities/appointment.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Staff } from '../staff/entities/staff.entity';
import type { BookingWarning } from './booking-warnings';
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
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    @InjectRepository(Appointment)
    private appointmentRepository: Repository<Appointment>,
    @InjectRepository(AppointmentServiceEntity)
    private appointmentServiceRepository: Repository<AppointmentServiceEntity>,
    @InjectRepository(Service)
    private serviceRepository: Repository<Service>,
    private readonly bookingAvailabilityService: BookingAvailabilityService,
  ) {}

  /**
   * Crea una reserva desde el panel.
   *
   * Antes preguntaba al motor conversacional —el que le sugiere horarios a un
   * cliente por WhatsApp— y tomaba su primera sugerencia como permiso. Eso tenía
   * dos consecuencias: un horario ocupado se guardaba igual si ese día había
   * *otro* libre, y el reparto de profesionales salía de un horario distinto del
   * pedido.
   *
   * Ahora el panel pide un horario exacto y se registra tal cual. Lo que no
   * cierra —pasado, día cerrado, fuera de horario, alguien fuera de turno—
   * vuelve como **advertencias**, porque registrar una excepción es trabajo
   * legítimo del dueño. Los bloqueos son los que no admiten interpretación: un
   * servicio que no existe, una duración inválida, un profesional que no hace
   * ese servicio, y el índice único.
   *
   * WhatsApp no pasa por acá: entra por `createFromBookingFlow` y sigue con las
   * reglas estrictas del cliente.
   */
  async create(dto: CreateAppointmentDto): Promise<{
    appointment: AppointmentDetail;
    warnings: BookingWarning[];
  }> {
    const tenantId = dto.tenantId;
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
    });

    if (!plan.ok) {
      throw new BadRequestException(
        `Servicio inexistente o inactivo: ${plan.missingServiceIds.join(', ')}`,
      );
    }

    const staffById = await this.resolveBookingStaff(tenantId, dto.items);

    const segments = plan.segments.map((segment) => ({
      staffId: segment.staffId,
      staffName: staffById.get(segment.staffId)?.name ?? null,
      startTime: segment.startTime,
      endTime: segment.endTime,
    }));

    const { date } = this.getDateTimeParts(startTime, timezone);

    const warnings =
      await this.bookingAvailabilityService.inspectRequestedBooking({
        tenantId,
        date,
        segments,
      });

    /*
     * Una cita cuya **fecha** ya pasó nace atendida: lo que se está haciendo es
     * registrar historia, no agendar. Se decide por fecha y no por instante a
     * propósito: una hora que ya pasó hoy sigue siendo parte de la jornada en
     * curso, y el dueño la resuelve desde la agenda como cualquier otra.
     *
     * De paso, una atendida no ocupa la agenda —`activeStartTime` queda en
     * `null`—, así que cargar historia nunca choca con el índice único ni le
     * quita disponibilidad a nadie.
     */
    const today = currentCalendarDate(timezone, new Date());
    const requested = parseCalendarDate(date);
    const isHistorical = requested ? daysInRange(requested, today) > 1 : false;

    const status = isHistorical
      ? AppointmentStatus.COMPLETED
      : AppointmentStatus.PENDING;

    const appointmentId = await this.insertBooking({
      tenantId,
      clientId: dto.clientId,
      status,
      startTime,
      plan,
    });

    return {
      appointment: await this.findDetailByTenant(appointmentId, tenantId),
      warnings,
    };
  }

  /**
   * Inserta la cita y sus tramos, todo o nada.
   *
   * Es la contraparte de `replaceSegments`: la misma transacción y la misma
   * traducción del índice único a "ese horario acaba de ocuparse". Sin
   * transacción, un choque en los tramos deja una cita sin servicios, que no
   * tiene profesional, ni precio, ni lugar en la agenda.
   */
  private async insertBooking(input: {
    tenantId: string;
    clientId: string;
    status: AppointmentStatus;
    startTime: Date;
    plan: Extract<ReturnType<typeof planBookingSegments>, { ok: true }>;
  }): Promise<string> {
    const { tenantId, clientId, status, startTime, plan } = input;
    const claimsSlot = blocksAgenda(status);

    try {
      return await this.appointmentRepository.manager.transaction(
        async (manager) => {
          const appointment = await manager.save(
            manager.create(Appointment, {
              tenantId,
              clientId,
              status,
              startTime,
              endTime: plan.endTime,
            }),
          );

          await manager.save(
            plan.segments.map((segment) =>
              manager.create(AppointmentServiceEntity, {
                appointmentId: appointment.id,
                serviceId: segment.serviceId,
                staffId: segment.staffId,
                startTime: segment.startTime,
                endTime: segment.endTime,
                activeStartTime: claimsSlot ? segment.startTime : null,
                priceAtBooking: segment.price,
                durationAtBooking: segment.durationMinutes,
                sequenceOrder: segment.sequenceOrder,
              }),
            ),
          );

          return appointment.id;
        },
      );
    } catch (error: unknown) {
      if (isDuplicateEntryError(error)) {
        throw new ConflictException(
          'Ese horario acaba de ocuparse. Elegí otro.',
        );
      }
      throw error;
    }
  }

  /**
   * Los profesionales de una reserva, verificando que puedan hacer su servicio.
   *
   * Es un bloqueo y no una advertencia: que alguien no ofrezca ese servicio no es
   * una excepción que el negocio quiera registrar, es un dato incoherente. El
   * panel elige de listas filtradas, así que llegar acá con un par inválido
   * significa que algo se desincronizó.
   */
  private async resolveBookingStaff(
    tenantId: string,
    items: Array<{ serviceId: string; staffId: string }>,
  ): Promise<Map<string, { id: string; name: string }>> {
    const staffRepo = this.appointmentRepository.manager.getRepository(Staff);

    const staffIds = [...new Set(items.map((item) => item.staffId))];
    const staff = await staffRepo.find({
      where: { id: In(staffIds), tenantId, isActive: true },
      relations: { services: true },
    });

    const byId = new Map(staff.map((member) => [member.id, member]));

    for (const item of items) {
      const member = byId.get(item.staffId);
      if (!member) {
        throw new BadRequestException(
          `El profesional ${item.staffId} no existe o no está activo`,
        );
      }

      const offersService = (member.services ?? []).some(
        (service) => service.id === item.serviceId,
      );

      if (!offersService) {
        throw new BadRequestException(
          `${member.name} no ofrece el servicio seleccionado`,
        );
      }
    }

    return new Map(
      staff.map((member) => [member.id, { id: member.id, name: member.name }]),
    );
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

  async remove(id: string) {
    await this.appointmentRepository.delete(id);
    return { deleted: true };
  }

  /**
   * Cambia el estado de una cita.
   *
   * Es lo único que edita este método, y por eso es tan corto. Antes recibía
   * también servicios y horario y los revalidaba con el motor conversacional,
   * pero eso ya vive en `editBookingByTenant`, que recibe el estado deseado
   * completo y lo escribe en una transacción. Mantener dos formas de reescribir
   * una reserva era garantizar que se separaran.
   */
  async updateByTenant(
    id: string,
    tenantId: string,
    dto: UpdateAppointmentStatusDto,
  ) {
    const { affected } = await this.appointmentRepository.update(
      { id, tenantId },
      { status: dto.status },
    );

    // Sin esto, pedir el estado de una cita ajena devolvería sus datos.
    if (!affected) {
      throw new NotFoundException('La cita no existe');
    }

    // Un cambio de estado libera o reclama el horario en el índice único.
    await this.syncActiveSlot(id, dto.status);

    return this.findDetailByTenant(id, tenantId);
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
   * Rige la misma política que `create`: **advierte, no impide**. Alargar una
   * reserva de las 16:30 con un servicio más, aunque se pase de la hora de
   * cierre, es trabajo legítimo del negocio —el cliente ya está sentado en la
   * silla—, y hasta acá se rechazaba con un "elegí otra hora". Los bloqueos son
   * los que no admiten interpretación: la cita tiene que existir y estar
   * abierta, el servicio tiene que estar activo, el profesional tiene que hacer
   * ese servicio, y el índice único sigue siendo la última barrera.
   *
   * Las advertencias se calculan excluyendo esta misma cita: sus propios minutos
   * no pueden contar como ocupados contra sí misma, o correr la hora quince
   * minutos avisaría que se pisa consigo misma.
   *
   * WhatsApp no se ablanda por esto. El flujo del cliente revalida con
   * `confirmSlot` antes de llegar acá y corta si el horario no está disponible;
   * la estrictez vive en el flujo, igual que en `createFromBookingFlow`.
   *
   * Los recordatorios no se tocan acá. La reconciliación corre cada cinco
   * minutos, recalcula el aviso desde el inicio de la cita y mueve el que
   * corresponda; uno ya enviado se queda enviado, que es la verdad.
   */
  async editBookingByTenant(
    id: string,
    tenantId: string,
    dto: EditBookingDto,
  ): Promise<{ appointment: AppointmentDetail; warnings: BookingWarning[] }> {
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

    // Bloqueo, no advertencia: que alguien no haga ese servicio no es una
    // excepción que el negocio quiera registrar, es un dato incoherente.
    const staffById = await this.resolveBookingStaff(tenantId, dto.items);

    const { date } = this.getDateTimeParts(startTime, timezone);

    const warnings =
      await this.bookingAvailabilityService.inspectRequestedBooking({
        tenantId,
        date,
        segments: plan.segments.map((segment) => ({
          staffId: segment.staffId,
          staffName: staffById.get(segment.staffId)?.name ?? null,
          startTime: segment.startTime,
          endTime: segment.endTime,
        })),
        excludeAppointmentId: id,
      });

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

    return {
      appointment: await this.findDetailByTenant(id, tenantId),
      warnings,
    };
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

  /**
   * Borra una reserva de verdad, en cualquier estado.
   *
   * No es cancelar: cancelar deja la reserva en la historia del negocio con su
   * horario liberado, y es lo que corresponde cuando un cliente no viene. Esto es
   * la herramienta administrativa para lo que **nunca debió existir**: una prueba,
   * una carga duplicada, un error de tipeo. Por eso vale en cualquier estado y por
   * eso no se puede deshacer.
   *
   * Los tramos y los recordatorios se van con ella: las dos claves foráneas están
   * en cascada, así que no hace falta borrarlos a mano ni queda nada colgado.
   *
   * Se registra en el log antes de perderla. Es lo único que va a quedar de una
   * reserva que ya no se puede recuperar.
   */
  async removeByTenant(id: string, tenantId: string) {
    const appointment = await this.appointmentRepository.findOne({
      where: { id, tenantId },
    });

    if (!appointment) {
      throw new NotFoundException('La cita no existe');
    }

    await this.appointmentRepository.delete({ id, tenantId });

    this.logger.warn(
      `Reserva eliminada del panel (tenantId=${tenantId}, appointmentId=${id}, estado=${appointment.status}, inicio=${appointment.startTime.toISOString()}).`,
    );

    return { deleted: true };
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
