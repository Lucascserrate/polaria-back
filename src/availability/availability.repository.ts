import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import {
  Appointment,
  BLOCKING_APPOINTMENT_STATUSES,
} from '../appointments/entities/appointment.entity';
import { AppointmentService as AppointmentServiceEntity } from '../appointments/entities/appointment_service.entity';
import { BusinessHour } from '../business_hours/entities/business_hour.entity';
import { Service } from '../services/entities/service.entity';
import { Staff } from '../staff/entities/staff.entity';
import { BOOKABLE_STAFF_WHERE } from '../staff/staff-role';
import { StaffSchedule } from '../staff/entities/staff_schedule.entity';
import { ScheduleBlock } from '../schedule-blocks/entities/schedule-block.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import {
  parseCalendarDate,
  rangeWindow,
} from '../appointments/appointment-window';
import { makeDateInTimeZone, addMinutes } from './utils/availability.helpers';
import type { SlotRange } from './utils/availability.types';
import { groupBlocksByStaff } from './utils/schedule-blocks';

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
    @InjectRepository(StaffSchedule)
    private readonly staffScheduleRepository: Repository<StaffSchedule>,
    @InjectRepository(ScheduleBlock)
    private readonly scheduleBlockRepository: Repository<ScheduleBlock>,
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

  /** Catálogo activo del negocio, ordenado por nombre. */
  async getActiveServices(tenantId: string): Promise<Service[]> {
    return this.serviceRepository.find({
      where: { tenantId, isActive: true },
      order: { name: 'ASC' },
    });
  }

  /**
   * Todas las franjas del negocio, de los siete días.
   *
   * No se filtra por día en SQL a propósito: quien decide qué franjas aplican es
   * `resolveWorkingRanges`, que recibe la fecha completa para poder contemplar
   * más adelante las excepciones por fecha. Filtrar acá obligaría al llamador a
   * derivar el día de la semana, que es justamente la parte que no debe salir
   * del resolvedor. Son siete filas: traerlas enteras no cuesta nada.
   */
  async getBusinessHours(tenantId: string): Promise<BusinessHour[]> {
    return this.businessHourRepository.find({
      where: { tenantId },
      order: { dayOfWeek: 'ASC', startTime: 'ASC' },
    });
  }

  /**
   * Jornadas propias de varios profesionales, agrupadas por `staffId`.
   *
   * Una sola consulta para todo el equipo. Los profesionales sin jornada propia
   * quedan con un array vacío, que es lo que `resolveWorkingRanges` espera.
   */
  async getStaffSchedules(
    staffIds: string[],
  ): Promise<Record<string, StaffSchedule[]>> {
    const uniqueStaffIds = Array.from(new Set(staffIds)).filter(Boolean);

    const grouped: Record<string, StaffSchedule[]> = {};
    for (const id of uniqueStaffIds) grouped[id] = [];

    if (!uniqueStaffIds.length) return grouped;

    const schedules = await this.staffScheduleRepository.find({
      where: { staffId: In(uniqueStaffIds) },
      order: { dayOfWeek: 'ASC', startTime: 'ASC' },
    });

    for (const schedule of schedules) {
      grouped[schedule.staffId] ??= [];
      grouped[schedule.staffId].push(schedule);
    }

    return grouped;
  }

  /**
   * Las franjas marcadas como no disponibles que le aplican a cada profesional.
   *
   * Una sola lista plana cubre el rango entero, sin agrupar por día: los
   * bloqueos son instantes absolutos, así que los que caen fuera de una fecha no
   * se solapan con su jornada y no hace falta separarlos.
   *
   * El reparto de los bloqueos del negocio entero lo hace `groupBlocksByStaff`,
   * que es donde se puede probar sin base.
   *
   * @param toDate Último día del rango, inclusive. Omitido, es un solo día.
   */
  async getScheduleBlocksByStaff(
    tenantId: string,
    timeZone: string,
    staffIds: string[],
    fromDate: string,
    toDate?: string,
  ): Promise<Record<string, SlotRange[]>> {
    const uniqueStaffIds = Array.from(new Set(staffIds)).filter(Boolean);
    if (!uniqueStaffIds.length) return {};

    const blocks = await this.getScheduleBlocks(
      tenantId,
      timeZone,
      uniqueStaffIds,
      fromDate,
      toDate,
    );

    return groupBlocksByStaff(blocks, uniqueStaffIds);
  }

  /**
   * Los mismos bloqueos, pero sin repartir: cada fila conserva de quién es.
   *
   * Lo que necesitan las advertencias del panel, que no restan el bloqueo sino
   * que lo explican y para eso tienen que poder nombrarlo. Ver
   * `collectBookingWarnings`.
   */
  async getScheduleBlocks(
    tenantId: string,
    timeZone: string,
    staffIds: string[],
    fromDate: string,
    toDate?: string,
  ): Promise<ScheduleBlock[]> {
    const uniqueStaffIds = Array.from(new Set(staffIds)).filter(Boolean);
    if (!uniqueStaffIds.length) return [];

    const from = parseCalendarDate(fromDate);
    const to = parseCalendarDate(toDate ?? fromDate);
    if (!from || !to) return [];

    /*
     * La ventana sale de `rangeWindow` y no de sumarle 24 horas al primer día:
     * con un cambio de horario de verano en el medio, la medianoche del último
     * día no está a 24 horas de la del primero y el rango quedaría corto justo
     * en la punta.
     */
    const { startUtc, endUtc } = rangeWindow(timeZone, from, to);

    /*
     * Solapamiento, no inicio: un bloqueo puede haber empezado el día anterior y
     * seguir tapando la primera hora del rango.
     */
    const overlapping = {
      tenantId,
      startTime: LessThan(endUtc),
      endTime: MoreThan(startUtc),
    };

    return this.scheduleBlockRepository.find({
      where: [
        { ...overlapping, staffId: In(uniqueStaffIds) },
        { ...overlapping, staffId: IsNull() },
      ],
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
        where: { id: staffId, tenantId, ...BOOKABLE_STAFF_WHERE },
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

      return [staff];
    }

    const qb = this.staffRepository
      .createQueryBuilder('staff')
      .leftJoin('staff.services', 'service')
      .where('staff.tenantId = :tenantId', { tenantId })
      .andWhere('staff.isActive = :isActive', {
        isActive: BOOKABLE_STAFF_WHERE.isActive,
      })
      .andWhere('staff.providesServices = :providesServices', {
        providesServices: BOOKABLE_STAFF_WHERE.providesServices,
      });

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

  /**
   * Quiénes pueden recibir reservas, con sus servicios.
   *
   * "Activo" no alcanza: un administrativo puede estar activo y no atender a
   * nadie. El criterio completo es `BOOKABLE_STAFF_WHERE`, que es el mismo que
   * aplica `getStaffList` y el que valida el guardado de una cita.
   */
  async getActiveStaffWithServices(tenantId: string): Promise<Staff[]> {
    return this.staffRepository.find({
      where: { tenantId, ...BOOKABLE_STAFF_WHERE },
      order: { name: 'ASC' },
      relations: { services: true },
    });
  }

  /**
   * Lo que cada profesional ya tiene ocupado ese día.
   *
   * @param excludeAppointmentId Cita que no cuenta como ocupada. Es lo que
   * necesita editar una reserva: sus propios minutos no pueden bloquear su
   * horario nuevo, o mover una cita quince minutos daría "ocupado" contra sí
   * misma. Cualquier otro consumidor lo omite y nada cambia.
   */
  async getAppointmentsByStaff(
    tenantId: string,
    desiredDate: string,
    timeZone: string,
    staffIds: string[],
    excludeAppointmentId?: string,
  ): Promise<Record<string, Array<{ startTime: Date; endTime: Date }>>> {
    const uniqueStaffIds = Array.from(new Set(staffIds)).filter(Boolean);
    if (!uniqueStaffIds.length) return {};

    const dayStart = makeDateInTimeZone(desiredDate, '00:00', timeZone);
    const nextDayStart = addMinutes(dayStart, 24 * 60);
    const dayEnd = new Date(nextDayStart.getTime() - 1);

    let query = this.appointmentServiceRepository
      .createQueryBuilder('as')
      .innerJoin('as.appointment', 'a')
      .where('a.tenantId = :tenantId', { tenantId })
      .andWhere('a.status IN (:...statuses)', {
        statuses: [...BLOCKING_APPOINTMENT_STATUSES],
      })
      .andWhere('as.staffId IN (:...staffIds)', { staffIds: uniqueStaffIds })
      .andWhere('as.startTime BETWEEN :dayStart AND :dayEnd', {
        dayStart,
        dayEnd,
      })
      .orderBy('as.startTime', 'ASC');

    if (excludeAppointmentId) {
      query = query.andWhere('as.appointmentId != :excludeAppointmentId', {
        excludeAppointmentId,
      });
    }

    const segments = await query.getMany();

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
}
