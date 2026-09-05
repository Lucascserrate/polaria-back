import { Injectable, Logger } from '@nestjs/common';

import type { Service } from '../../services/entities/service.entity';
import { isSelfBookable } from '../../services/booking-policy';
import type { Staff } from '../../staff/entities/staff.entity';
import { AvailabilityCalculator } from '../availability.calculator';
import { AvailabilityRepository } from '../availability.repository';
import {
  addMinutes,
  currentDateInTimeZone,
  makeDateInTimeZone,
} from '../utils/availability.helpers';
import {
  datesWithCoverage,
  mergeRanges,
  resolveWorkingRangesByStaff,
  unionWorkingRanges,
} from '../utils/working-hours.resolver';
import {
  collectBookingWarnings,
  type BookingWarning,
  type RequestedSegment,
} from '../../appointments/booking-warnings';
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
  /**
   * Cita que no cuenta como ocupada.
   *
   * Es para editar una reserva: al preguntar qué horarios hay para *esta* cita,
   * sus propios minutos no pueden contar como ocupados. Sin esto, mover una cita
   * de 09:00 a 09:15 daría "ocupado" contra sí misma, que es el caso más común.
   */
  excludeAppointmentId?: string;
  /**
   * Quién pregunta, que es lo que define desde cuándo se ofrecen horarios.
   *
   * - `client`: desde ahora más la anticipación mínima. Es la regla de WhatsApp:
   *   nadie reserva para dentro de dos minutos.
   * - `panel`: desde este momento, sin anticipación —el administrador registra,
   *   no avisa— y sin piso alguno cuando la fecha ya pasó, porque ahí todo el
   *   día es válido para cargar historia.
   *
   * Es un solo eje en lugar de tres banderas sueltas: así no hay combinaciones
   * que nadie pensó, y el nombre dice por qué cambia la regla.
   */
  scope?: 'client' | 'panel';
};

/**
 * Clave con la que se pide la envolvente del negocio al resolver franjas.
 *
 * No es un profesional: es la forma de reusar el resolver para preguntar por el
 * horario del local, que es lo que resuelve para alguien sin jornada propia.
 */
const BUSINESS_PROBE = '__business__';

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
   *
   * Responde una sola pregunta: **qué se puede reservar**. Siempre desde ahora
   * en adelante, para cualquier consumidor. Registrar una atención que ya
   * ocurrió es otra cosa —no hay disponibilidad que consultar sobre el pasado— y
   * no se resuelve relajando este cálculo.
   */
  async getAvailableSlots(query: BookingSlotsQuery): Promise<BookingSlot[]> {
    const context = await this.loadContext(query);
    if (!context) return [];

    return buildBookingSlots({
      candidateSlots: context.candidateSlots,
      staffIds: context.staffIds,
      workingRangesByStaff: context.workingRangesByStaff,
      appointmentsByStaff: context.appointmentsByStaff,
      minStartTime: context.minStartTime,
    });
  }

  /**
   * Servicios que tienen al menos un horario disponible en la fecha dada.
   *
   * **Hoy no lo usa el flujo de reservas.** Servía cuando la fecha se elegía
   * primero, para no ofrecer un servicio sin cupo ese día. Con la fecha puesta en
   * hoy por defecto ese filtro dejaba el primer paso vacío justo cuando hoy no
   * tenía cupo, así que la falta de disponibilidad se descubre ahora en el paso de
   * horarios, que sí ofrece salida.
   *
   * Se conserva porque es la consulta que hace falta para marcar días sin cupo en
   * un calendario, que es lo que pide `unavailable-dates` del `CalendarPicker` de
   * WhatsApp Flows.
   */
  async getServicesWithAvailability(params: {
    tenantId: string;
    date: string;
  }): Promise<Service[]> {
    const { tenantId, date } = params;

    const tenant = await this.availabilityRepository.getTenant(tenantId);
    const timeZone = tenant?.timezone;
    if (!timeZone) return [];

    /*
     * Solo los reservables por el cliente. Esta consulta alimenta los días sin
     * cupo del `CalendarPicker` de WhatsApp Flows, que es un canal del cliente: un
     * servicio con consulta previa marcaría un día como disponible por algo que
     * ese cliente no puede reservar.
     */
    const services = (
      await this.availabilityRepository.getActiveServices(tenantId)
    ).filter((service) => isSelfBookable(service.bookingPolicy));
    if (services.length === 0) return [];

    const staffList =
      await this.availabilityRepository.getActiveStaffWithServices(tenantId);
    if (staffList.length === 0) return [];

    const [businessHours, schedulesByStaff] = await Promise.all([
      this.availabilityRepository.getBusinessHours(tenantId),
      this.availabilityRepository.getStaffSchedules(
        staffList.map((staff) => staff.id),
      ),
    ]);

    const workingRangesByStaff = resolveWorkingRangesByStaff({
      date,
      timeZone,
      businessHours,
      staff: staffList,
      schedulesByStaff,
    });

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

      // La grilla se arma con la cobertura de quienes hacen este servicio y
      // trabajan ese día, no con la del equipo entero.
      const staffIds = staffIdsForService(staffList, service.id).filter(
        (id) => workingRangesByStaff[id].length > 0,
      );
      if (staffIds.length === 0) return false;

      const candidateSlots = this.availabilityCalculator.generateCandidateSlots(
        unionWorkingRanges(workingRangesByStaff, staffIds),
        service.durationMinutes,
        DEFAULT_SLOT_STEP_MINUTES,
      );

      return (
        buildBookingSlots({
          candidateSlots,
          staffIds,
          workingRangesByStaff,
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
   * De una lista de fechas, las que el negocio realmente atiende.
   *
   * Sirve para no ofrecer días que no llevan a ninguna parte: elegir "domingo
   * 23" y recibir "no quedan horarios" para un día en que el local ni abre no es
   * un error del cálculo, es haber presentado como opción algo que nunca lo fue.
   *
   * Son tres consultas para todas las fechas juntas, no tres por fecha: lo que
   * decide qué día sirve son el horario del negocio y las jornadas del equipo, y
   * eso se carga una vez y se resuelve en memoria.
   *
   * No mira la agenda, así que un día abierto pero con todo tomado sigue
   * apareciendo. Ese caso ya tiene salida propia en el paso de horarios. Lo que
   * sí descarta es el día cuya jornada ya terminó —hoy, después de cerrar—,
   * porque ahí no hay nada que la agenda pueda cambiar.
   */
  async getServiceableDates(params: {
    tenantId: string;
    dates: string[];
    /** Ausente busca cobertura de cualquiera del equipo. */
    serviceId?: string;
    staffId?: string;
  }): Promise<string[]> {
    const { tenantId, dates, serviceId, staffId } = params;
    if (dates.length === 0) return [];

    const tenant = await this.availabilityRepository.getTenant(tenantId);
    const timeZone = tenant?.timezone;
    if (!timeZone) {
      this.logger.warn(`Tenant sin timezone (tenantId=${tenantId}).`);
      return [];
    }

    const staffList = await this.availabilityRepository.getStaffList(
      tenantId,
      serviceId ? [serviceId] : [],
      staffId,
    );
    if (staffList.length === 0) return [];

    const [businessHours, schedulesByStaff] = await Promise.all([
      this.availabilityRepository.getBusinessHours(tenantId),
      this.availabilityRepository.getStaffSchedules(
        staffList.map((staff) => staff.id),
      ),
    ]);

    return datesWithCoverage({
      dates,
      timeZone,
      businessHours,
      staff: staffList,
      schedulesByStaff,
      /*
       * El mismo piso que usa el armado de horarios. Sin él, un negocio
       * consultado diez minutos antes de cerrar ofrecía "hoy" como día con
       * atención y el paso siguiente contestaba que no quedan horarios: el
       * primer contacto con la reserva era un callejón sin salida.
       */
      notBefore: this.calculateMinStartTime(timeZone),
    });
  }

  /**
   * Qué problemas tiene un horario que el panel pidió explícitamente.
   *
   * Es la otra pregunta, la que no responde `getAvailableSlots`. Ese enumera lo
   * ofrecible a un cliente; esto examina un pedido concreto del administrador y
   * devuelve advertencias, no un permiso. Quién decide qué hacer con ellas es la
   * pantalla: el panel es una herramienta administrativa y registrar una
   * excepción es trabajo legítimo.
   *
   * Carga el horario del negocio y las jornadas una sola vez para todos los
   * tramos, y las decisiones las toma el módulo puro `booking-warnings`.
   */
  async inspectRequestedBooking(input: {
    tenantId: string;
    /** Fecha del pedido, `YYYY-MM-DD` en la zona del negocio. */
    date: string;
    segments: RequestedSegment[];
    /**
     * Cita que no cuenta como ocupada. La necesita la edición: los minutos que
     * la reserva ya tenía no pueden contar como "pisado" contra sí misma.
     */
    excludeAppointmentId?: string;
    now?: Date;
  }): Promise<BookingWarning[]> {
    const { tenantId, date, segments } = input;
    if (segments.length === 0) return [];

    const tenant = await this.availabilityRepository.getTenant(tenantId);
    const timeZone = tenant?.timezone;
    if (!timeZone) {
      this.logger.warn(`Tenant sin timezone (tenantId=${tenantId}).`);
      return [];
    }

    const staffIds = [...new Set(segments.map((segment) => segment.staffId))];

    const [businessHours, schedulesByStaff, staffList, busyByStaff] =
      await Promise.all([
        this.availabilityRepository.getBusinessHours(tenantId),
        this.availabilityRepository.getStaffSchedules(staffIds),
        this.availabilityRepository.getActiveStaffWithServices(tenantId),
        this.availabilityRepository.getAppointmentsByStaff(
          tenantId,
          date,
          timeZone,
          staffIds,
          input.excludeAppointmentId,
        ),
      ]);

    const staff = staffIds.map((id) => ({
      id,
      usesCustomSchedule:
        staffList.find((member) => member.id === id)?.usesCustomSchedule ??
        false,
    }));

    const workingRangesByStaff = resolveWorkingRangesByStaff({
      date,
      timeZone,
      businessHours,
      staff,
      schedulesByStaff,
    });

    /*
     * El horario del negocio se resuelve como la jornada de alguien sin jornada
     * propia: es exactamente la definición de la envolvente, sin repetir el
     * cálculo de franjas ni el manejo de zona horaria.
     */
    const businessRanges = mergeRanges(
      resolveWorkingRangesByStaff({
        date,
        timeZone,
        businessHours,
        staff: [{ id: BUSINESS_PROBE, usesCustomSchedule: false }],
        schedulesByStaff: {},
      })[BUSINESS_PROBE],
    );

    return collectBookingWarnings({
      now: input.now ?? new Date(),
      segments,
      businessRanges,
      workingRangesByStaff,
      busyByStaff,
    });
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
      workingRangesByStaff: context.workingRangesByStaff,
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
    workingRangesByStaff: Record<string, SlotRange[]>;
    appointmentsByStaff: StaffBusyMap;
    /** Ausente en el registro manual: ahí no hay hora mínima que respetar. */
    minStartTime?: Date;
  } | null> {
    const {
      tenantId,
      date,
      serviceId,
      staffId,
      excludeAppointmentId,
      scope = 'client',
    } = query;

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

    /*
     * Un servicio con consulta previa no tiene horarios **para el cliente**.
     *
     * La regla vive acá y no en cada canal porque `loadContext` es por donde pasan
     * los tres —el flujo de WhatsApp, el Flow y la página pública— tanto para
     * listar horarios como para confirmar uno. Esconder el servicio de la lista de
     * opciones es la comodidad; que su id no rinda ningún horario es lo que hace
     * que sea una regla y no una sugerencia.
     *
     * `scope === 'panel'` la saltea a propósito: el negocio agenda estos servicios
     * justamente después de la consulta, que es el punto de la política. Ese scope
     * solo llega desde el endpoint autenticado del panel; la página pública manda
     * `'client'` escrito a mano y no puede pedir otra cosa.
     */
    if (scope === 'client' && !isSelfBookable(service.bookingPolicy)) {
      return null;
    }

    const staffList = await this.availabilityRepository.getStaffList(
      tenantId,
      [serviceId],
      staffId,
    );
    if (staffList.length === 0) return null;

    const [businessHours, schedulesByStaff] = await Promise.all([
      this.availabilityRepository.getBusinessHours(tenantId),
      this.availabilityRepository.getStaffSchedules(
        staffList.map((staff) => staff.id),
      ),
    ]);

    const workingRangesByStaff = resolveWorkingRangesByStaff({
      date,
      timeZone,
      businessHours,
      staff: staffList,
      schedulesByStaff,
    });

    // Solo siguen los que efectivamente trabajan esa fecha. Esto también cubre
    // el negocio cerrado: con el local sin franjas, nadie queda en pie.
    const staffIds = staffList
      .map((staff) => staff.id)
      .filter((id) => workingRangesByStaff[id].length > 0);
    if (staffIds.length === 0) return null;

    const appointmentsByStaff =
      await this.availabilityRepository.getAppointmentsByStaff(
        tenantId,
        date,
        timeZone,
        staffIds,
        excludeAppointmentId,
      );

    const candidateSlots = this.availabilityCalculator.generateCandidateSlots(
      unionWorkingRanges(workingRangesByStaff, staffIds),
      service.durationMinutes,
      DEFAULT_SLOT_STEP_MINUTES,
    );

    return {
      candidateSlots,
      staffIds,
      workingRangesByStaff,
      appointmentsByStaff,
      minStartTime: this.resolveEarliestStart(timeZone, date, scope),
    };
  }

  /**
   * Desde qué instante se ofrecen horarios, o `undefined` cuando no hay piso.
   *
   * Sin piso solo en el panel y sobre una fecha pasada: es la única situación en
   * la que ofrecer un horario que ya pasó tiene sentido, porque lo que se está
   * haciendo es registrar lo que ocurrió.
   */
  private resolveEarliestStart(
    timeZone: string,
    date: string,
    scope: 'client' | 'panel',
  ): Date | undefined {
    if (scope === 'client') return this.calculateMinStartTime(timeZone);

    const today = currentDateInTimeZone(timeZone, new Date());
    if (date < today) return undefined;

    // Hoy, para el panel: desde ahora, sin la anticipación del cliente.
    return this.currentInstantIn(timeZone);
  }

  private currentInstantIn(timeZone: string): Date {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());

    const [today, now] = parts.split(', ');
    return makeDateInTimeZone(today, now, timeZone);
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
