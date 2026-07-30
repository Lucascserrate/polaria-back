import { Injectable, Logger } from '@nestjs/common';

import { AppointmentsService } from '../appointments/appointments.service';
import { BookingAvailabilityService } from '../availability/booking/booking-availability.service';
import type { BookingSlot } from '../availability/booking/booking-slot.type';
import { ServicesService } from '../services/services.service';
import { StaffService } from '../staff/staff.service';
import { TenantsService } from '../tenants/tenants.service';
import {
  classifyInteraction,
  nextStateAfter,
  readStaffSelection,
} from './booking-flow.machine';
import {
  BOOKING_DATE_HORIZON_DAYS,
  BookingSessionState,
  RESERVED_VALUES,
  StaffPreference,
  type BookingOption,
  type BookingPrompt,
  type BookingSummary,
} from './booking-flow.types';
import { encodeSelection } from './booking-payload.codec';
import { BookingSessionService } from './booking-session.service';
import type { BookingSession } from './entities/booking-session.entity';
import {
  addDaysToIsoDate,
  formatDateLabel,
  formatTimeLabel,
  todayIsoDateIn,
} from './utils/booking-date.util';

const DEFAULT_TIMEZONE = 'America/La_Paz';

/**
 * Orquestador del flujo guiado de reservas.
 *
 * Recibe interacciones ya estructuradas, consulta el dominio de disponibilidad y
 * devuelve el `BookingPrompt` que corresponde mostrar. No conoce WhatsApp: el
 * renderizador traduce el prompt al componente del transporte que toque.
 *
 * En ningún punto interpreta texto libre para completar datos.
 */
@Injectable()
export class BookingFlowService {
  private readonly logger = new Logger(BookingFlowService.name);

  constructor(
    private readonly bookingSessionService: BookingSessionService,
    private readonly bookingAvailabilityService: BookingAvailabilityService,
    private readonly appointmentsService: AppointmentsService,
    private readonly servicesService: ServicesService,
    private readonly staffService: StaffService,
    private readonly tenantsService: TenantsService,
  ) {}

  /** Indica si el cliente está dentro de un flujo de reserva (conversación congelada). */
  async hasActiveSession(params: {
    tenantId: string;
    clientId: string;
  }): Promise<boolean> {
    const session = await this.bookingSessionService.findActive(params);
    return session !== null;
  }

  /**
   * Arranca el flujo. Es lo único que la IA puede disparar: detecta la intención
   * de reservar y llama acá, sin aportar ningún dato.
   */
  async start(params: {
    tenantId: string;
    clientId: string;
    conversationId?: string;
    now?: Date;
  }): Promise<BookingPrompt> {
    const now = params.now ?? new Date();
    const session = await this.bookingSessionService.start({
      tenantId: params.tenantId,
      clientId: params.clientId,
      conversationId: params.conversationId,
      now,
    });

    return this.askWhenPrompt(session);
  }

  /**
   * Respuesta al texto libre cuando hay un flujo abierto.
   *
   * Devuelve `null` si no hay sesión activa, y en ese caso el mensaje sigue su
   * camino normal hacia el asistente. Si la hay, el texto no se interpreta: se
   * reenvía el paso actual envuelto en `FROZEN`.
   */
  async handleFreeText(params: {
    tenantId: string;
    clientId: string;
    now?: Date;
  }): Promise<BookingPrompt | null> {
    const now = params.now ?? new Date();
    const session = await this.bookingSessionService.findActive(params);
    if (!session) return null;

    if (session.expiresAt.getTime() <= now.getTime()) {
      await this.bookingSessionService.expire(session, now);
      return { kind: 'EXPIRED' };
    }

    const refreshed = await this.bookingSessionService.reissue({
      session,
      now,
    });
    const current = await this.promptForCurrentState(refreshed);
    return { kind: 'FROZEN', current };
  }

  /**
   * Procesa una respuesta interactiva: la única vía por la que el flujo avanza.
   */
  async handleSelection(params: {
    tenantId: string;
    clientId: string;
    rawSelectionId: string;
    metaMessageId?: string | null;
    now?: Date;
  }): Promise<BookingPrompt> {
    const now = params.now ?? new Date();

    const session = await this.bookingSessionService.findActive({
      tenantId: params.tenantId,
      clientId: params.clientId,
    });

    if (!session) return { kind: 'STALE' };

    const verdict = classifyInteraction({
      session,
      rawSelectionId: params.rawSelectionId,
      metaMessageId: params.metaMessageId,
      now,
    });

    switch (verdict.kind) {
      case 'DUPLICATE':
        this.logger.log(
          `Reentrega de webhook descartada (sessionId=${session.id}, metaMessageId=${String(params.metaMessageId)}).`,
        );
        return { kind: 'NONE' };

      case 'CANCEL':
        await this.bookingSessionService.cancel(session, now);
        return { kind: 'CANCELLED' };

      case 'EXPIRED':
        await this.bookingSessionService.expire(session, now);
        return { kind: 'EXPIRED' };

      case 'FOREIGN':
      case 'STALE':
      case 'MALFORMED':
        this.logger.warn(
          `Interacción descartada (${verdict.kind}) (sessionId=${session.id}, state=${session.state}, stepVersion=${session.stepVersion}).`,
        );
        await this.bookingSessionService.markMetaMessageProcessed(
          session,
          params.metaMessageId,
        );
        return { kind: 'STALE' };

      case 'ACCEPT':
        return this.applySelection({
          session,
          value: verdict.value,
          metaMessageId: params.metaMessageId,
          now,
        });
    }
  }

  /** Cancela el flujo abierto, si hay alguno. */
  async cancel(params: {
    tenantId: string;
    clientId: string;
    now?: Date;
  }): Promise<BookingPrompt> {
    const now = params.now ?? new Date();
    const session = await this.bookingSessionService.findActive(params);
    if (!session) return { kind: 'STALE' };

    await this.bookingSessionService.cancel(session, now);
    return { kind: 'CANCELLED' };
  }

  // -------------------------------------------------------------------------
  // Transiciones
  // -------------------------------------------------------------------------

  private async applySelection(params: {
    session: BookingSession;
    value: string;
    metaMessageId?: string | null;
    now: Date;
  }): Promise<BookingPrompt> {
    const { session, value, metaMessageId, now } = params;

    switch (session.state) {
      case BookingSessionState.ASK_WHEN:
        return this.afterWhen({ session, value, metaMessageId, now });

      case BookingSessionState.ASK_DATE:
        return this.afterDate({ session, date: value, metaMessageId, now });

      case BookingSessionState.ASK_SERVICE:
        return this.afterService({
          session,
          serviceId: value,
          metaMessageId,
          now,
        });

      case BookingSessionState.ASK_STAFF:
        return this.afterStaff({ session, value, metaMessageId, now });

      case BookingSessionState.ASK_SLOT:
        return this.afterSlot({ session, value, metaMessageId, now });

      case BookingSessionState.CONFIRM:
        return this.afterConfirm({ session, metaMessageId, now });

      default:
        return { kind: 'STALE' };
    }
  }

  private async afterWhen(params: {
    session: BookingSession;
    value: string;
    metaMessageId?: string | null;
    now: Date;
  }): Promise<BookingPrompt> {
    const { session, value, metaMessageId, now } = params;
    const chosenOtherDay = value === RESERVED_VALUES.OTHER_DAY;

    const nextState = nextStateAfter(BookingSessionState.ASK_WHEN, {
      chosenOtherDay,
    });

    if (chosenOtherDay) {
      const advanced = await this.bookingSessionService.advance({
        session,
        state: nextState,
        metaMessageId,
        now,
      });
      return this.askDatePrompt(advanced, now);
    }

    const timezone = await this.resolveTimezone(session.tenantId);
    const today = todayIsoDateIn(timezone, now);

    const advanced = await this.bookingSessionService.advance({
      session,
      state: nextState,
      selection: { selectedDate: today },
      metaMessageId,
      now,
    });

    return this.askServicePrompt(advanced, today);
  }

  private async afterDate(params: {
    session: BookingSession;
    date: string;
    metaMessageId?: string | null;
    now: Date;
  }): Promise<BookingPrompt> {
    const { session, date, metaMessageId, now } = params;

    const advanced = await this.bookingSessionService.advance({
      session,
      state: nextStateAfter(BookingSessionState.ASK_DATE),
      selection: { selectedDate: date },
      metaMessageId,
      now,
    });

    return this.askServicePrompt(advanced, date);
  }

  private async afterService(params: {
    session: BookingSession;
    serviceId: string;
    metaMessageId?: string | null;
    now: Date;
  }): Promise<BookingPrompt> {
    const { session, serviceId, metaMessageId, now } = params;

    const staff = await this.bookingAvailabilityService.getStaffForService({
      tenantId: session.tenantId,
      serviceId,
    });

    if (staff.length === 0) {
      await this.bookingSessionService.reissue({ session, metaMessageId, now });
      return { kind: 'NO_AVAILABILITY', scope: 'SERVICE' };
    }

    // Con un solo profesional habilitado el paso no aporta nada: se omite y la
    // preferencia queda registrada como específica, no como "sin preferencia".
    if (staff.length === 1) {
      const only = staff[0];
      const advanced = await this.bookingSessionService.advance({
        session,
        state: nextStateAfter(BookingSessionState.ASK_SERVICE, {
          skipStaffStep: true,
        }),
        selection: {
          selectedServiceId: serviceId,
          staffPreference: StaffPreference.SPECIFIC,
          selectedStaffId: only.id,
        },
        metaMessageId,
        now,
      });

      return this.askSlotPrompt(advanced);
    }

    const advanced = await this.bookingSessionService.advance({
      session,
      state: nextStateAfter(BookingSessionState.ASK_SERVICE),
      selection: { selectedServiceId: serviceId },
      metaMessageId,
      now,
    });

    return this.askStaffPrompt(advanced, staff);
  }

  private async afterStaff(params: {
    session: BookingSession;
    value: string;
    metaMessageId?: string | null;
    now: Date;
  }): Promise<BookingPrompt> {
    const { session, value, metaMessageId, now } = params;
    const { staffPreference, staffId } = readStaffSelection(value);

    const advanced = await this.bookingSessionService.advance({
      session,
      state: nextStateAfter(BookingSessionState.ASK_STAFF),
      selection: { staffPreference, selectedStaffId: staffId },
      metaMessageId,
      now,
    });

    return this.askSlotPrompt(advanced);
  }

  private async afterSlot(params: {
    session: BookingSession;
    value: string;
    metaMessageId?: string | null;
    now: Date;
  }): Promise<BookingPrompt> {
    const { session, value, metaMessageId, now } = params;

    const advanced = await this.bookingSessionService.advance({
      session,
      state: nextStateAfter(BookingSessionState.ASK_SLOT),
      selection: { selectedSlotStart: new Date(value) },
      metaMessageId,
      now,
    });

    return this.confirmPrompt(advanced);
  }

  /**
   * Confirmación: revalida la disponibilidad y, si sigue libre, crea la reserva.
   *
   * Es el único punto donde se escribe. Si el horario se ocupó mientras el cliente
   * decidía, no se crea nada y se devuelve `SLOT_TAKEN` con la lista fresca.
   */
  private async afterConfirm(params: {
    session: BookingSession;
    metaMessageId?: string | null;
    now: Date;
  }): Promise<BookingPrompt> {
    const { session, metaMessageId, now } = params;

    // Idempotencia: si esta sesión ya creó su reserva, no se crea otra.
    if (session.appointmentId) {
      const summary = await this.buildSummary(session);
      return summary
        ? {
            kind: 'COMPLETED',
            summary,
            appointmentId: session.appointmentId,
          }
        : { kind: 'STALE' };
    }

    const { selectedDate, selectedServiceId, selectedSlotStart } = session;
    if (!selectedDate || !selectedServiceId || !selectedSlotStart) {
      this.logger.warn(
        `Confirmación sin datos completos (sessionId=${session.id}).`,
      );
      return { kind: 'STALE' };
    }

    const confirmation = await this.bookingAvailabilityService.confirmSlot({
      tenantId: session.tenantId,
      date: selectedDate,
      serviceId: selectedServiceId,
      staffId: session.selectedStaffId ?? undefined,
      startTime: selectedSlotStart,
    });

    if (!confirmation.available) {
      const reissued = await this.bookingSessionService.advance({
        session,
        state: BookingSessionState.ASK_SLOT,
        selection: { selectedSlotStart: null },
        metaMessageId,
        now,
      });

      const slots = await this.loadSlots(reissued);
      const timezone = await this.resolveTimezone(session.tenantId);
      return {
        kind: 'SLOT_TAKEN',
        date: selectedDate,
        options: this.slotOptions(reissued, slots, timezone),
      };
    }

    const appointment = await this.appointmentsService.createFromBookingFlow({
      tenantId: session.tenantId,
      clientId: session.clientId,
      serviceId: selectedServiceId,
      staffId: confirmation.staffId,
      startTime: confirmation.startTime,
      endTime: confirmation.endTime,
    });

    const completed = await this.bookingSessionService.complete({
      session,
      appointmentId: appointment.id,
      metaMessageId,
      now,
    });

    // El profesional definitivo es el que resolvió la revalidación, incluso si el
    // cliente había elegido "Sin preferencia".
    const summary = await this.buildSummary(completed, confirmation.staffId);

    return summary
      ? { kind: 'COMPLETED', summary, appointmentId: appointment.id }
      : { kind: 'STALE' };
  }

  // -------------------------------------------------------------------------
  // Construcción de prompts
  // -------------------------------------------------------------------------

  /** Reconstruye el prompt del paso en curso, para reenviar el componente. */
  private async promptForCurrentState(
    session: BookingSession,
  ): Promise<BookingPrompt> {
    switch (session.state) {
      case BookingSessionState.ASK_WHEN:
        return this.askWhenPrompt(session);

      case BookingSessionState.ASK_DATE:
        return this.askDatePrompt(session, new Date());

      case BookingSessionState.ASK_SERVICE:
        return this.askServicePrompt(session, session.selectedDate ?? '');

      case BookingSessionState.ASK_STAFF: {
        const staff = session.selectedServiceId
          ? await this.bookingAvailabilityService.getStaffForService({
              tenantId: session.tenantId,
              serviceId: session.selectedServiceId,
            })
          : [];
        return this.askStaffPrompt(session, staff);
      }

      case BookingSessionState.ASK_SLOT:
        return this.askSlotPrompt(session);

      case BookingSessionState.CONFIRM:
        return this.confirmPrompt(session);

      default:
        return { kind: 'STALE' };
    }
  }

  private askWhenPrompt(session: BookingSession): BookingPrompt {
    return {
      kind: 'ASK_WHEN',
      options: [
        this.option(session, RESERVED_VALUES.TODAY, 'Hoy'),
        this.option(session, RESERVED_VALUES.OTHER_DAY, 'Otro día'),
        this.cancelOption(session),
      ],
    };
  }

  private async askDatePrompt(
    session: BookingSession,
    now: Date,
  ): Promise<BookingPrompt> {
    const timezone = await this.resolveTimezone(session.tenantId);
    const today = todayIsoDateIn(timezone, now);

    const options: BookingOption[] = [];
    for (let offset = 1; offset <= BOOKING_DATE_HORIZON_DAYS; offset += 1) {
      const date = addDaysToIsoDate(today, offset);
      options.push(this.option(session, date, formatDateLabel(date)));
    }

    return {
      kind: 'ASK_DATE',
      options: [...options, this.cancelOption(session)],
    };
  }

  private async askServicePrompt(
    session: BookingSession,
    date: string,
  ): Promise<BookingPrompt> {
    const services =
      await this.bookingAvailabilityService.getServicesWithAvailability({
        tenantId: session.tenantId,
        date,
      });

    if (services.length === 0) {
      return { kind: 'NO_AVAILABILITY', scope: 'DATE' };
    }

    return {
      kind: 'ASK_SERVICE',
      date,
      options: [
        ...services.map((service) =>
          this.option(
            session,
            service.id,
            service.name,
            `${service.durationMinutes} min`,
          ),
        ),
        this.cancelOption(session),
      ],
    };
  }

  private askStaffPrompt(
    session: BookingSession,
    staff: Array<{ id: string; name: string }>,
  ): BookingPrompt {
    return {
      kind: 'ASK_STAFF',
      options: [
        ...staff.map((member) => this.option(session, member.id, member.name)),
        this.option(session, RESERVED_VALUES.ANY_STAFF, 'Sin preferencia'),
        this.cancelOption(session),
      ],
    };
  }

  private async askSlotPrompt(session: BookingSession): Promise<BookingPrompt> {
    const slots = await this.loadSlots(session);

    if (slots.length === 0) {
      return {
        kind: 'NO_AVAILABILITY',
        scope: session.selectedStaffId ? 'STAFF' : 'SERVICE',
      };
    }

    const timezone = await this.resolveTimezone(session.tenantId);

    return {
      kind: 'ASK_SLOT',
      date: session.selectedDate ?? '',
      options: this.slotOptions(session, slots, timezone),
    };
  }

  private async confirmPrompt(session: BookingSession): Promise<BookingPrompt> {
    const summary = await this.buildSummary(session);
    if (!summary) return { kind: 'STALE' };

    return {
      kind: 'CONFIRM',
      summary,
      options: [
        this.option(session, RESERVED_VALUES.CONFIRM, 'Confirmar'),
        this.cancelOption(session),
      ],
    };
  }

  // -------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------

  private loadSlots(session: BookingSession): Promise<BookingSlot[]> {
    if (!session.selectedDate || !session.selectedServiceId) {
      return Promise.resolve([]);
    }

    return this.bookingAvailabilityService.getAvailableSlots({
      tenantId: session.tenantId,
      date: session.selectedDate,
      serviceId: session.selectedServiceId,
      staffId: session.selectedStaffId ?? undefined,
    });
  }

  private slotOptions(
    session: BookingSession,
    slots: BookingSlot[],
    timezone: string,
  ): BookingOption[] {
    return [
      ...slots.map((slot) =>
        this.option(
          session,
          slot.startTime.toISOString(),
          formatTimeLabel(slot.startTime, timezone),
        ),
      ),
      this.cancelOption(session),
    ];
  }

  private async buildSummary(
    session: BookingSession,
    resolvedStaffId?: string,
  ): Promise<BookingSummary | null> {
    const { tenantId, selectedDate, selectedServiceId, selectedSlotStart } =
      session;

    if (!selectedDate || !selectedServiceId || !selectedSlotStart) return null;

    const service = await this.servicesService.findOneByTenant(
      selectedServiceId,
      tenantId,
    );
    if (!service) return null;

    const staffId = resolvedStaffId ?? session.selectedStaffId;
    const staff = staffId ? await this.staffService.findOne(staffId) : null;

    return {
      date: selectedDate,
      serviceName: service.name,
      serviceDurationMinutes: service.durationMinutes,
      staffName: staff?.name ?? null,
      startTime: selectedSlotStart,
      endTime: new Date(
        selectedSlotStart.getTime() + service.durationMinutes * 60_000,
      ),
    };
  }

  private option(
    session: BookingSession,
    value: string,
    title: string,
    description?: string,
  ): BookingOption {
    return {
      selectionId: encodeSelection({
        token: session.token,
        stepVersion: session.stepVersion,
        state: session.state,
        value,
      }),
      title,
      description,
    };
  }

  /** Salida siempre visible, en todos los pasos. */
  private cancelOption(session: BookingSession): BookingOption {
    return this.option(session, RESERVED_VALUES.CANCEL, 'Cancelar');
  }

  private async resolveTimezone(tenantId: string): Promise<string> {
    const tenant = await this.tenantsService.findOne(tenantId);
    return tenant?.timezone ?? DEFAULT_TIMEZONE;
  }
}
