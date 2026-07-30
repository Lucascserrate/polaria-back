import { Injectable, Logger } from '@nestjs/common';

import type { Service } from '../../services/entities/service.entity';
import type { Staff } from '../../staff/entities/staff.entity';
import { AvailabilityCalculator } from '../availability.calculator';
import { AvailabilityRepository } from '../availability.repository';
import {
  addMinutes,
  getDayOfWeek,
  makeDateInTimeZone,
} from '../utils/availability.helpers';
import type { SlotRange } from '../utils/availability.types';
import {
  DEFAULT_SLOT_STEP_MINUTES,
  MIN_LEAD_TIME_MINUTES,
  type BookingSlot,
} from './booking-slot.type';
import {
  buildBookingSlots,
  findBookingSlotAt,
  type StaffBusyMap,
} from './slot-builder';
import {
  calculateWorkloadByStaffId,
  resolveStaffForSlot,
} from './staff-assignment';

export type BookingSlotsQuery = {
  tenantId: string;
  /** Fecha en formato YYYY-MM-DD, en la zona horaria del negocio. */
  date: string;
  serviceId: string;
  /** Profesional elegido. Omitirlo equivale a "Sin preferencia". */
  staffId?: string;
};

export type SlotConfirmation =
  | { available: true; startTime: Date; endTime: Date; staffId: string }
  | { available: false };

/**
 * Disponibilidad para el flujo guiado de reservas.
 *
 * Convive con `AvailabilityService`, que sigue sirviendo al flujo conversacional
 * y al panel. La diferencia es de propósito: aquel *sugiere* horarios para que
 * los narre la IA; este *enumera* los horarios reales para llenar un componente
 * interactivo, y resuelve el profesional de forma determinista.
 *
 * No conoce WhatsApp ni ningún transporte.
 */
@Injectable()
export class BookingAvailabilityService {
  private readonly logger = new Logger(BookingAvailabilityService.name);

  constructor(
    private readonly availabilityRepository: AvailabilityRepository,
    private readonly availabilityCalculator: AvailabilityCalculator,
  ) {}

  /**
   * Todos los horarios disponibles para un servicio y una fecha, sin recortes.
   *
   * Cada horario incluye los profesionales habilitados y libres. Cuando se pasa
   * `staffId`, la lista queda restringida a ese profesional; cuando no, es la
   * unión de disponibilidades de todos los que pueden hacer el servicio.
   */
  async getAvailableSlots(query: BookingSlotsQuery): Promise<BookingSlot[]> {
    const context = await this.loadContext(query);
    if (!context) return [];

    return buildBookingSlots({
      candidateSlots: context.candidateSlots,
      staffIds: context.staffIds,
      appointmentsByStaff: context.appointmentsByStaff,
      minStartTime: context.minStartTime,
    });
  }

  /**
   * Servicios que tienen al menos un horario disponible en la fecha dada.
   *
   * Se usa para el paso de selección de servicio: si el cliente ya eligió el
   * viernes, mostrarle un servicio sin cupo ese día lo lleva a un callejón sin
   * salida. Resuelve todo con un único juego de consultas y el resto en memoria.
   */
  async getServicesWithAvailability(params: {
    tenantId: string;
    date: string;
  }): Promise<Service[]> {
    const { tenantId, date } = params;

    const tenant = await this.availabilityRepository.getTenant(tenantId);
    const timeZone = tenant?.timezone;
    if (!timeZone) return [];

    const businessHours = await this.availabilityRepository.getBusinessHours(
      tenantId,
      getDayOfWeek(date, timeZone),
    );
    if (businessHours.length === 0) return [];

    const services =
      await this.availabilityRepository.getActiveServices(tenantId);
    if (services.length === 0) return [];

    const staffList =
      await this.availabilityRepository.getActiveStaffWithServices(tenantId);
    if (staffList.length === 0) return [];

    const appointmentsByStaff =
      await this.availabilityRepository.getAppointmentsByStaff(
        tenantId,
        date,
        timeZone,
        staffList.map((staff) => staff.id),
      );

    const minStartTime = this.calculateMinStartTime(timeZone);

    return services.filter((service) => {
      if (service.durationMinutes <= 0) return false;

      const staffIds = staffIdsForService(staffList, service.id);
      if (staffIds.length === 0) return false;

      const candidateSlots = this.availabilityCalculator.generateCandidateSlots(
        businessHours,
        date,
        timeZone,
        service.durationMinutes,
        DEFAULT_SLOT_STEP_MINUTES,
      );

      return (
        buildBookingSlots({
          candidateSlots,
          staffIds,
          appointmentsByStaff,
          minStartTime,
        }).length > 0
      );
    });
  }

  /**
   * Profesionales habilitados para un servicio. Alimenta el paso de selección de
   * profesional, que se omite cuando devuelve uno solo.
   */
  getStaffForService(params: {
    tenantId: string;
    serviceId: string;
  }): Promise<Staff[]> {
    return this.availabilityRepository.getStaffList(params.tenantId, [
      params.serviceId,
    ]);
  }

  /**
   * Revalida un horario justo antes de crear la reserva y resuelve qué
   * profesional lo atiende.
   *
   * No existen bloqueos temporales: entre que se mostró la lista y el cliente
   * eligió, otro cliente pudo tomar el horario. Esta es la única barrera, y
   * corre siempre.
   *
   * Cuando el cliente eligió "Sin preferencia" (`staffId` ausente), el
   * profesional se decide acá: menor carga de trabajo del día en minutos, con
   * desempate por id.
   */
  async confirmSlot(
    query: BookingSlotsQuery & { startTime: Date },
  ): Promise<SlotConfirmation> {
    const context = await this.loadContext(query);
    if (!context) return { available: false };

    const slots = buildBookingSlots({
      candidateSlots: context.candidateSlots,
      staffIds: context.staffIds,
      appointmentsByStaff: context.appointmentsByStaff,
      minStartTime: context.minStartTime,
    });

    const slot = findBookingSlotAt(slots, query.startTime);
    if (!slot) return { available: false };

    const staffId = resolveStaffForSlot({
      eligibleStaffIds: slot.eligibleStaffIds,
      workloadByStaffId: calculateWorkloadByStaffId(
        context.appointmentsByStaff,
      ),
    });

    if (!staffId) return { available: false };

    return {
      available: true,
      startTime: slot.startTime,
      endTime: slot.endTime,
      staffId,
    };
  }

  /**
   * Carga en un solo lugar todo lo que necesitan el cálculo de slots y la
   * asignación de profesional. Devuelve `null` cuando la fecha es inviable
   * (negocio cerrado, servicio inexistente, sin profesionales habilitados).
   */
  private async loadContext(query: BookingSlotsQuery): Promise<{
    candidateSlots: SlotRange[];
    staffIds: string[];
    appointmentsByStaff: StaffBusyMap;
    minStartTime: Date;
  } | null> {
    const { tenantId, date, serviceId, staffId } = query;

    const tenant = await this.availabilityRepository.getTenant(tenantId);
    const timeZone = tenant?.timezone;
    if (!timeZone) {
      this.logger.warn(`Tenant sin timezone (tenantId=${tenantId}).`);
      return null;
    }

    const services = await this.availabilityRepository.getServices(tenantId, [
      serviceId,
    ]);
    const service = services[0];
    if (!service || service.durationMinutes <= 0) return null;

    const businessHours = await this.availabilityRepository.getBusinessHours(
      tenantId,
      getDayOfWeek(date, timeZone),
    );
    if (businessHours.length === 0) return null;

    const staffList = await this.availabilityRepository.getStaffList(
      tenantId,
      [serviceId],
      staffId,
    );
    if (staffList.length === 0) return null;

    const staffIds = staffList.map((staff) => staff.id);

    const appointmentsByStaff =
      await this.availabilityRepository.getAppointmentsByStaff(
        tenantId,
        date,
        timeZone,
        staffIds,
      );

    const candidateSlots = this.availabilityCalculator.generateCandidateSlots(
      businessHours,
      date,
      timeZone,
      service.durationMinutes,
      DEFAULT_SLOT_STEP_MINUTES,
    );

    return {
      candidateSlots,
      staffIds,
      appointmentsByStaff,
      minStartTime: this.calculateMinStartTime(timeZone),
    };
  }

  private calculateMinStartTime(timeZone: string): Date {
    const nowParts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());

    const [today, now] = nowParts.split(', ');
    return addMinutes(
      makeDateInTimeZone(today, now, timeZone),
      MIN_LEAD_TIME_MINUTES,
    );
  }
}

function staffIdsForService(staffList: Staff[], serviceId: string): string[] {
  return staffList
    .filter((staff) =>
      (staff.services ?? []).some((service) => service.id === serviceId),
    )
    .map((staff) => staff.id);
}
