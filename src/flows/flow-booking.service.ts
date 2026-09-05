import { Injectable, Logger } from '@nestjs/common';

import { AppointmentsService } from '../appointments/appointments.service';
import { SlotAlreadyTakenError } from '../appointments/slot-already-taken.error';
import { BookingAvailabilityService } from '../availability/booking/booking-availability.service';
import { BOOKING_DATE_HORIZON_DAYS } from '../booking-flow/booking-flow.types';
import { BookingSessionService } from '../booking-flow/booking-session.service';
import {
  BookingSessionState,
  StaffPreference,
} from '../booking-flow/booking-flow.types';
import type { BookingSession } from '../booking-flow/entities/booking-session.entity';
import {
  addDaysToIsoDate,
  formatDateLabel,
  formatTimeLabel,
  todayIsoDateIn,
} from '../booking-flow/utils/booking-date.util';
import { ServicesService } from '../services/services.service';
import { formatPrice } from '../services/utils/price-format.util';
import { StaffService } from '../staff/staff.service';
import { TenantsService } from '../tenants/tenants.service';
import {
  ANY_STAFF,
  buildBookingScreen,
  buildSummaryScreen,
  buildTerminalResponse,
  emptyBookingScreen,
  type FlowOption,
  type FlowResponse,
} from './flow-screen';

const DEFAULT_TIMEZONE = 'America/La_Paz';

/** Lo que cada pantalla manda en el payload del `data_exchange`. */
export type FlowBookingPayload = {
  service?: string;
  staff?: string;
  date?: string;
  slot?: string;
};

/**
 * Reserva por WhatsApp Flows.
 *
 * Comparte el dominio con el canal nativo —disponibilidad, asignación por menor
 * carga, revalidación, índice único— pero no su máquina paso a paso: dentro del
 * Flow las cuatro selecciones viven en una sola pantalla y el cliente las va
 * completando en cascada.
 *
 * Eso no relaja la regla central. Cada valor que llega se **revalida contra las
 * opciones que este mismo servicio genera**: un servicio que no está activo, un
 * profesional que no hace ese servicio o un horario que no está libre se rechazan
 * aunque vengan bien formados.
 */
@Injectable()
export class FlowBookingService {
  private readonly logger = new Logger(FlowBookingService.name);

  constructor(
    private readonly bookingSessionService: BookingSessionService,
    private readonly bookingAvailabilityService: BookingAvailabilityService,
    private readonly appointmentsService: AppointmentsService,
    private readonly servicesService: ServicesService,
    private readonly staffService: StaffService,
    private readonly tenantsService: TenantsService,
  ) {}

  /** Primera pantalla: solo los servicios habilitados. */
  async init(session: BookingSession): Promise<FlowResponse> {
    return emptyBookingScreen(await this.serviceOptions(session.tenantId));
  }

  /**
   * Eligió servicio: se habilitan profesional y fecha, y **ya vuelven los
   * horarios de hoy**.
   *
   * Ese último punto es el que hace que reservar para hoy —el caso mayoritario en
   * una barbería— cueste dos toques: servicio y horario.
   */
  async onServiceSelected(
    session: BookingSession,
    payload: FlowBookingPayload,
  ): Promise<FlowResponse> {
    const services = await this.serviceOptions(session.tenantId);
    const serviceId = payload.service;

    if (!serviceId || !services.some((option) => option.id === serviceId)) {
      return emptyBookingScreen(
        services,
        'Ese servicio ya no está disponible.',
      );
    }

    const staff = await this.bookingAvailabilityService.getStaffForService({
      tenantId: session.tenantId,
      serviceId,
    });

    if (staff.length === 0) {
      return emptyBookingScreen(
        services,
        'Ese servicio no tiene a nadie asignado por ahora.',
      );
    }

    // Con un solo profesional el desplegable no aporta una decisión: se resuelve
    // acá y queda apagado, igual que el paso omitido del canal nativo.
    const onlyStaffId = staff.length === 1 ? staff[0].id : undefined;

    const timezone = await this.resolveTimezone(session.tenantId);
    const today = todayIsoDateIn(timezone);

    await this.remember(session, {
      selectedServiceId: serviceId,
      selectedStaffId: onlyStaffId ?? null,
      staffPreference: onlyStaffId ? StaffPreference.SPECIFIC : null,
      selectedDate: today,
      selectedSlotStart: null,
    });

    return buildBookingScreen({
      services,
      staff: onlyStaffId ? [] : this.staffOptions(staff),
      isStaffEnabled: !onlyStaffId,
      dates: await this.dateOptions(session.tenantId, today, serviceId),
      isDateEnabled: true,
      slots: await this.slotOptions(session.tenantId, {
        serviceId,
        staffId: onlyStaffId,
        date: today,
      }),
      isSlotEnabled: true,
    });
  }

  /** Eligió profesional: se recalculan los horarios de la fecha vigente. */
  async onStaffSelected(
    session: BookingSession,
    payload: FlowBookingPayload,
  ): Promise<FlowResponse> {
    const services = await this.serviceOptions(session.tenantId);
    const serviceId = payload.service;

    if (!serviceId || !services.some((option) => option.id === serviceId)) {
      return emptyBookingScreen(
        services,
        'Ese servicio ya no está disponible.',
      );
    }

    const staff = await this.bookingAvailabilityService.getStaffForService({
      tenantId: session.tenantId,
      serviceId,
    });

    const staffId = this.resolveStaffChoice(payload.staff, staff);
    if (staffId === undefined && payload.staff !== ANY_STAFF) {
      return this.bookingScreenWithError(
        session,
        services,
        staff,
        'Ese profesional ya no atiende ese servicio.',
      );
    }

    const timezone = await this.resolveTimezone(session.tenantId);
    const date = session.selectedDate ?? todayIsoDateIn(timezone);

    await this.remember(session, {
      selectedStaffId: staffId ?? null,
      staffPreference: staffId ? StaffPreference.SPECIFIC : StaffPreference.ANY,
    });

    return buildBookingScreen({
      services,
      staff: this.staffOptions(staff),
      isStaffEnabled: true,
      dates: await this.dateOptions(
        session.tenantId,
        todayIsoDateIn(timezone),
        serviceId,
      ),
      isDateEnabled: true,
      slots: await this.slotOptions(session.tenantId, {
        serviceId,
        staffId,
        date,
      }),
      isSlotEnabled: true,
    });
  }

  /** Eligió fecha: se recalculan los horarios de ese día. */
  async onDateSelected(
    session: BookingSession,
    payload: FlowBookingPayload,
  ): Promise<FlowResponse> {
    const services = await this.serviceOptions(session.tenantId);
    const serviceId = payload.service;

    if (!serviceId || !services.some((option) => option.id === serviceId)) {
      return emptyBookingScreen(
        services,
        'Ese servicio ya no está disponible.',
      );
    }

    const timezone = await this.resolveTimezone(session.tenantId);
    const today = todayIsoDateIn(timezone);
    const dates = await this.dateOptions(session.tenantId, today, serviceId);

    const date = payload.date;
    if (!date || !dates.some((option) => option.id === date)) {
      return this.bookingScreenWithError(
        session,
        services,
        await this.bookingAvailabilityService.getStaffForService({
          tenantId: session.tenantId,
          serviceId,
        }),
        'Esa fecha ya no se puede reservar.',
      );
    }

    const staff = await this.bookingAvailabilityService.getStaffForService({
      tenantId: session.tenantId,
      serviceId,
    });
    const staffId = this.resolveStaffChoice(payload.staff, staff);

    await this.remember(session, {
      selectedDate: date,
      selectedSlotStart: null,
    });

    return buildBookingScreen({
      services,
      staff: staff.length === 1 ? [] : this.staffOptions(staff),
      isStaffEnabled: staff.length > 1,
      dates,
      isDateEnabled: true,
      slots: await this.slotOptions(session.tenantId, {
        serviceId,
        staffId: staff.length === 1 ? staff[0].id : staffId,
        date,
      }),
      isSlotEnabled: true,
    });
  }

  /**
   * Pantalla de revisión.
   *
   * El resumen lo arma el servidor y no el cliente: es la razón por la que este
   * paso es un `data_exchange` y no un `navigate`.
   */
  async onReview(
    session: BookingSession,
    payload: FlowBookingPayload,
  ): Promise<FlowResponse> {
    const { service: serviceId, date, slot } = payload;

    if (!serviceId || !date || !slot) {
      return emptyBookingScreen(
        await this.serviceOptions(session.tenantId),
        'Faltan datos para continuar. Empecemos de nuevo.',
      );
    }

    const service = await this.servicesService.findOneByTenant(
      serviceId,
      session.tenantId,
    );
    if (!service) {
      return emptyBookingScreen(
        await this.serviceOptions(session.tenantId),
        'Ese servicio ya no está disponible.',
      );
    }

    const timezone = await this.resolveTimezone(session.tenantId);
    const currency = await this.resolveCurrency(session.tenantId);
    const staffName = await this.resolveStaffName(payload.staff);

    const lines = [
      `${service.name} (${service.durationMinutes} min)`,
      formatDateLabel(date),
      formatTimeLabel(new Date(slot), timezone),
    ];

    const price = formatPrice(service.price, currency);
    if (price) lines.push(price);

    // Con "Sin preferencia" no se nombra a nadie: el profesional se decide por
    // menor carga recién al confirmar, y anticiparlo acá podría mentir.
    if (staffName) lines.push(`Con ${staffName}`);

    await this.remember(session, {
      selectedServiceId: serviceId,
      selectedDate: date,
      selectedSlotStart: new Date(slot),
    });

    return buildSummaryScreen({
      summary: lines.join('\n'),
      service: serviceId,
      staff: payload.staff ?? ANY_STAFF,
      date,
      slot,
    });
  }

  /**
   * Confirmación: revalida contra disponibilidad fresca y crea la reserva.
   *
   * Es el único punto donde se escribe, y el único que decide qué profesional
   * atiende cuando el cliente eligió "Sin preferencia".
   */
  async onConfirm(
    session: BookingSession,
    payload: FlowBookingPayload,
    now: Date = new Date(),
  ): Promise<FlowResponse> {
    // Idempotencia: Meta reintenta el endpoint si tarda, y no hay `metaMessageId`
    // acá que permita reconocer la reentrega.
    if (session.appointmentId) {
      return buildTerminalResponse(session.token, {
        status: 'completed',
        appointment_id: session.appointmentId,
      });
    }

    const { service: serviceId, date, slot } = payload;
    if (!serviceId || !date || !slot) {
      return buildTerminalResponse(session.token, { status: 'incomplete' });
    }

    const staff = await this.bookingAvailabilityService.getStaffForService({
      tenantId: session.tenantId,
      serviceId,
    });
    const staffId =
      staff.length === 1
        ? staff[0].id
        : this.resolveStaffChoice(payload.staff, staff);

    const confirmation = await this.bookingAvailabilityService.confirmSlot({
      tenantId: session.tenantId,
      date,
      serviceId,
      staffId,
      startTime: new Date(slot),
    });

    if (!confirmation.available) {
      return buildTerminalResponse(session.token, { status: 'slot_taken' });
    }

    try {
      const appointment = await this.appointmentsService.createFromBookingFlow({
        tenantId: session.tenantId,
        clientId: session.clientId,
        serviceId,
        staffId: confirmation.staffId,
        startTime: confirmation.startTime,
        endTime: confirmation.endTime,
      });

      await this.bookingSessionService.complete({
        session,
        appointmentId: appointment.id,
        now,
      });

      return buildTerminalResponse(session.token, {
        status: 'completed',
        appointment_id: appointment.id,
      });
    } catch (error: unknown) {
      // El índice único es la última barrera contra reservas duplicadas.
      if (error instanceof SlotAlreadyTakenError) {
        this.logger.warn(
          `Carrera perdida contra el índice único (sessionId=${session.id}): ${error.message}`,
        );
        return buildTerminalResponse(session.token, { status: 'slot_taken' });
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Opciones
  // -------------------------------------------------------------------------

  /** El precio va en el título: el `data-source` de un `Dropdown` solo lleva id y título. */
  private async serviceOptions(tenantId: string): Promise<FlowOption[]> {
    const [services, currency] = await Promise.all([
      // Solo los reservables por el cliente: el Flow es un canal suyo.
      this.servicesService.findSelfBookableByTenant(tenantId),
      this.resolveCurrency(tenantId),
    ]);

    return services.map((service) => {
      const price = formatPrice(service.price, currency);
      return {
        id: service.id,
        title: price ? `${service.name} — ${price}` : service.name,
      };
    });
  }

  private staffOptions(
    staff: Array<{ id: string; name: string }>,
  ): FlowOption[] {
    return [
      { id: ANY_STAFF, title: 'Sin preferencia' },
      ...staff.map((member) => ({ id: member.id, title: member.name })),
    ];
  }

  /**
   * Los días que el negocio atiende, dentro del horizonte de reserva.
   *
   * Solo los que tienen cobertura real: un domingo cerrado, o un día en que no
   * trabaja nadie del equipo, no se ofrece. Antes se listaban los catorce
   * siguientes sin mirar nada y elegir uno cerrado devolvía "no quedan horarios"
   * para un día en que el local ni abre.
   *
   * El servicio elegido acota la pregunta: si solo una persona lo hace, valen sus
   * días.
   */
  private async dateOptions(
    tenantId: string,
    today: string,
    serviceId?: string,
  ): Promise<FlowOption[]> {
    const horizon = Array.from({ length: BOOKING_DATE_HORIZON_DAYS }, (_, i) =>
      addDaysToIsoDate(today, i),
    );

    const dates = await this.bookingAvailabilityService.getServiceableDates({
      tenantId,
      dates: horizon,
      serviceId,
    });

    return dates.map((date) => ({
      id: date,
      title:
        date === horizon[0]
          ? 'Hoy'
          : date === horizon[1]
            ? 'Mañana'
            : formatDateLabel(date),
    }));
  }

  private async slotOptions(
    tenantId: string,
    params: { serviceId: string; staffId?: string; date: string },
  ): Promise<FlowOption[]> {
    const [slots, timezone] = await Promise.all([
      this.bookingAvailabilityService.getAvailableSlots({
        tenantId,
        date: params.date,
        serviceId: params.serviceId,
        staffId: params.staffId,
      }),
      this.resolveTimezone(tenantId),
    ]);

    return slots.map((slot) => ({
      id: slot.startTime.toISOString(),
      title: formatTimeLabel(slot.startTime, timezone),
    }));
  }

  // -------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------

  /**
   * Traduce la elección de profesional a un id, o `undefined` para "Sin
   * preferencia". Devuelve `undefined` también cuando el id no corresponde a
   * nadie habilitado, para que el llamador lo trate como error.
   */
  private resolveStaffChoice(
    choice: string | undefined,
    staff: Array<{ id: string }>,
  ): string | undefined {
    if (!choice || choice === ANY_STAFF) return undefined;
    return staff.some((member) => member.id === choice) ? choice : undefined;
  }

  private async resolveStaffName(
    choice: string | undefined,
  ): Promise<string | null> {
    if (!choice || choice === ANY_STAFF) return null;
    const staff = await this.staffService.findOne(choice);
    return staff?.name ?? null;
  }

  private async bookingScreenWithError(
    session: BookingSession,
    services: FlowOption[],
    staff: Array<{ id: string; name: string }>,
    errorMessage: string,
  ): Promise<FlowResponse> {
    const timezone = await this.resolveTimezone(session.tenantId);

    return buildBookingScreen({
      services,
      staff: this.staffOptions(staff),
      isStaffEnabled: staff.length > 1,
      dates: await this.dateOptions(session.tenantId, todayIsoDateIn(timezone)),
      isDateEnabled: true,
      slots: [],
      isSlotEnabled: false,
      errorMessage,
    });
  }

  /** Guarda lo elegido en la sesión, para que el panel vea una reserva coherente. */
  private async remember(
    session: BookingSession,
    selection: Parameters<BookingSessionService['advance']>[0]['selection'],
  ): Promise<void> {
    await this.bookingSessionService.advance({
      session,
      state: BookingSessionState.ASK_SLOT,
      selection,
      now: new Date(),
    });
  }

  private async resolveTimezone(tenantId: string): Promise<string> {
    const tenant = await this.tenantsService.findOne(tenantId);
    return tenant?.timezone ?? DEFAULT_TIMEZONE;
  }

  private async resolveCurrency(tenantId: string): Promise<string | null> {
    const tenant = await this.tenantsService.findOne(tenantId);
    return tenant?.currency ?? null;
  }
}
