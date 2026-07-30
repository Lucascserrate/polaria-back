import { Injectable, Logger } from '@nestjs/common';

import { AppointmentsService } from '../appointments/appointments.service';
import type { Appointment } from '../appointments/entities/appointment.entity';
import { SlotAlreadyTakenError } from '../appointments/slot-already-taken.error';
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
  type BookingChannelLimits,
  type BookingOption,
  type BookingPrompt,
  type BookingSummary,
} from './booking-flow.types';
import { encodeSelection } from './booking-payload.codec';
import { BookingSessionService } from './booking-session.service';
import type { BookingSession } from './entities/booking-session.entity';
import { computeOptionWindow } from './option-window';
import {
  addDaysToIsoDate,
  formatDateLabel,
  formatTimeLabel,
  todayIsoDateIn,
} from './utils/booking-date.util';

const DEFAULT_TIMEZONE = 'America/La_Paz';

/** `Cancelar` está siempre presente y por lo tanto siempre ocupa una opción. */
const RESERVED_OPTION_COUNT = 1;

/**
 * Orquestador del flujo guiado de reservas.
 *
 * Recibe interacciones ya estructuradas, consulta el dominio de disponibilidad y
 * devuelve el `BookingPrompt` que corresponde mostrar. No conoce WhatsApp: el
 * renderizador traduce el prompt al componente del transporte que toque, y le
 * informa su tope de opciones vía `BookingChannelLimits`.
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

  /** Indica si el cliente está dentro de un flujo (conversación congelada). */
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
  // No recibe `limits`: el primer paso son tres botones fijos, nunca pagina.
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
    limits?: BookingChannelLimits;
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
    const current = await this.promptForCurrentState(refreshed, params.limits);
    return { kind: 'FROZEN', current };
  }

  /** Procesa una respuesta interactiva: la única vía por la que el flujo avanza. */
  async handleSelection(params: {
    tenantId: string;
    clientId: string;
    rawSelectionId: string;
    metaMessageId?: string | null;
    limits?: BookingChannelLimits;
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
          limits: params.limits,
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
    limits?: BookingChannelLimits;
    now: Date;
  }): Promise<BookingPrompt> {
    const { session, value, metaMessageId, limits, now } = params;

    // "Ver más" no avanza de paso: solo pasa de página dentro del mismo.
    if (value === RESERVED_VALUES.MORE) {
      return this.nextPage({ session, metaMessageId, limits, now });
    }

    switch (session.state) {
      case BookingSessionState.ASK_WHEN:
        return this.afterWhen({ session, value, metaMessageId, limits, now });

      case BookingSessionState.ASK_DATE:
        return this.afterDate({
          session,
          date: value,
          metaMessageId,
          limits,
          now,
        });

      case BookingSessionState.ASK_SERVICE:
        return this.afterService({
          session,
          serviceId: value,
          metaMessageId,
          limits,
          now,
        });

      case BookingSessionState.ASK_STAFF:
        return this.afterStaff({ session, value, metaMessageId, limits, now });

      case BookingSessionState.ASK_SLOT:
        return this.afterSlot({ session, value, metaMessageId, now });

      case BookingSessionState.CONFIRM:
        return this.afterConfirm({ session, metaMessageId, limits, now });

      default:
        return { kind: 'STALE' };
    }
  }

  /**
   * Avanza una página del paso actual.
   *
   * El salto es del tamaño de la página que se acaba de mostrar, que se recalcula
   * con la misma ventana usada al renderizarla.
   */
  private async nextPage(params: {
    session: BookingSession;
    metaMessageId?: string | null;
    limits?: BookingChannelLimits;
    now: Date;
  }): Promise<BookingPrompt> {
    const { session, metaMessageId, limits, now } = params;

    const total = await this.countCurrentStepOptions(session);
    const window = this.window(total, session.pageOffset, limits);

    const advanced = await this.bookingSessionService.advance({
      session,
      state: session.state,
      selection: { pageOffset: window.hasMore ? window.end : 0 },
      metaMessageId,
      now,
    });

    return this.promptForCurrentState(advanced, limits);
  }

  private async afterWhen(params: {
    session: BookingSession;
    value: string;
    metaMessageId?: string | null;
    limits?: BookingChannelLimits;
    now: Date;
  }): Promise<BookingPrompt> {
    const { session, value, metaMessageId, limits, now } = params;
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
      return this.askDatePrompt(advanced, limits, now);
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

    return this.askServicePrompt(advanced, today, limits);
  }

  private async afterDate(params: {
    session: BookingSession;
    date: string;
    metaMessageId?: string | null;
    limits?: BookingChannelLimits;
    now: Date;
  }): Promise<BookingPrompt> {
    const { session, date, metaMessageId, limits, now } = params;

    const advanced = await this.bookingSessionService.advance({
      session,
      state: nextStateAfter(BookingSessionState.ASK_DATE),
      selection: { selectedDate: date },
      metaMessageId,
      now,
    });

    return this.askServicePrompt(advanced, date, limits);
  }

  private async afterService(params: {
    session: BookingSession;
    serviceId: string;
    metaMessageId?: string | null;
    limits?: BookingChannelLimits;
    now: Date;
  }): Promise<BookingPrompt> {
    const { session, serviceId, metaMessageId, limits, now } = params;

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
      const advanced = await this.bookingSessionService.advance({
        session,
        state: nextStateAfter(BookingSessionState.ASK_SERVICE, {
          skipStaffStep: true,
        }),
        selection: {
          selectedServiceId: serviceId,
          staffPreference: StaffPreference.SPECIFIC,
          selectedStaffId: staff[0].id,
        },
        metaMessageId,
        now,
      });

      return this.askSlotPrompt(advanced, limits);
    }

    const advanced = await this.bookingSessionService.advance({
      session,
      state: nextStateAfter(BookingSessionState.ASK_SERVICE),
      selection: { selectedServiceId: serviceId },
      metaMessageId,
      now,
    });

    return this.askStaffPrompt(advanced, staff, limits);
  }

  private async afterStaff(params: {
    session: BookingSession;
    value: string;
    metaMessageId?: string | null;
    limits?: BookingChannelLimits;
    now: Date;
  }): Promise<BookingPrompt> {
    const { session, value, metaMessageId, limits, now } = params;
    const { staffPreference, staffId } = readStaffSelection(value);

    const advanced = await this.bookingSessionService.advance({
      session,
      state: nextStateAfter(BookingSessionState.ASK_STAFF),
      selection: { staffPreference, selectedStaffId: staffId },
      metaMessageId,
      now,
    });

    return this.askSlotPrompt(advanced, limits);
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
    limits?: BookingChannelLimits;
    now: Date;
  }): Promise<BookingPrompt> {
    const { session, metaMessageId, limits, now } = params;

    // Idempotencia: si esta sesión ya creó su reserva, no se crea otra.
    if (session.appointmentId) {
      const summary = await this.buildSummary(session);
      return summary
        ? { kind: 'COMPLETED', summary, appointmentId: session.appointmentId }
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
      return this.slotTakenPrompt({ session, metaMessageId, limits, now });
    }

    let appointment: Appointment;
    try {
      appointment = await this.appointmentsService.createFromBookingFlow({
        tenantId: session.tenantId,
        clientId: session.clientId,
        serviceId: selectedServiceId,
        staffId: confirmation.staffId,
        startTime: confirmation.startTime,
        endTime: confirmation.endTime,
      });
    } catch (error: unknown) {
      // El índice único es la última barrera: si otro cliente insertó el mismo
      // horario en la ventana entre la revalidación y este insert, se trata igual
      // que un horario ocupado.
      if (error instanceof SlotAlreadyTakenError) {
        this.logger.warn(
          `Carrera perdida contra el índice único (sessionId=${session.id}): ${error.message}`,
        );
        return this.slotTakenPrompt({ session, metaMessageId, limits, now });
      }
      throw error;
    }

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

  /**
   * Vuelve al paso de horarios con la lista recalculada.
   *
   * Se usa tanto cuando la revalidación detecta el horario ocupado como cuando lo
   * detecta el índice único. Reinicia la paginación: la lista es otra.
   */
  private async slotTakenPrompt(params: {
    session: BookingSession;
    metaMessageId?: string | null;
    limits?: BookingChannelLimits;
    now: Date;
  }): Promise<BookingPrompt> {
    const { session, metaMessageId, limits, now } = params;

    const reissued = await this.bookingSessionService.advance({
      session,
      state: BookingSessionState.ASK_SLOT,
      selection: { selectedSlotStart: null, pageOffset: 0 },
      metaMessageId,
      now,
    });

    const slots = await this.loadSlots(reissued);
    const timezone = await this.resolveTimezone(reissued.tenantId);

    return {
      kind: 'SLOT_TAKEN',
      date: reissued.selectedDate ?? '',
      options: this.paginate(
        reissued,
        this.slotOptions(reissued, slots, timezone),
        limits,
      ),
    };
  }

  // -------------------------------------------------------------------------
  // Construcción de prompts
  // -------------------------------------------------------------------------

  /** Reconstruye el prompt del paso en curso, para reenviar el componente. */
  private async promptForCurrentState(
    session: BookingSession,
    limits?: BookingChannelLimits,
  ): Promise<BookingPrompt> {
    switch (session.state) {
      case BookingSessionState.ASK_WHEN:
        return this.askWhenPrompt(session);

      case BookingSessionState.ASK_DATE:
        return this.askDatePrompt(session, limits, new Date());

      case BookingSessionState.ASK_SERVICE:
        return this.askServicePrompt(
          session,
          session.selectedDate ?? '',
          limits,
        );

      case BookingSessionState.ASK_STAFF: {
        const staff = session.selectedServiceId
          ? await this.bookingAvailabilityService.getStaffForService({
              tenantId: session.tenantId,
              serviceId: session.selectedServiceId,
            })
          : [];
        return this.askStaffPrompt(session, staff, limits);
      }

      case BookingSessionState.ASK_SLOT:
        return this.askSlotPrompt(session, limits);

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
    limits: BookingChannelLimits | undefined,
    now: Date,
  ): Promise<BookingPrompt> {
    const timezone = await this.resolveTimezone(session.tenantId);

    return {
      kind: 'ASK_DATE',
      options: this.paginate(
        session,
        this.dateOptions(session, timezone, now),
        limits,
      ),
    };
  }

  private async askServicePrompt(
    session: BookingSession,
    date: string,
    limits?: BookingChannelLimits,
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
      options: this.paginate(
        session,
        services.map((service) =>
          this.option(
            session,
            service.id,
            service.name,
            `${service.durationMinutes} min`,
          ),
        ),
        limits,
      ),
    };
  }

  private askStaffPrompt(
    session: BookingSession,
    staff: Array<{ id: string; name: string }>,
    limits?: BookingChannelLimits,
  ): BookingPrompt {
    return {
      kind: 'ASK_STAFF',
      options: this.paginate(
        session,
        [
          ...staff.map((member) =>
            this.option(session, member.id, member.name),
          ),
          this.option(session, RESERVED_VALUES.ANY_STAFF, 'Sin preferencia'),
        ],
        limits,
      ),
    };
  }

  private async askSlotPrompt(
    session: BookingSession,
    limits?: BookingChannelLimits,
  ): Promise<BookingPrompt> {
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
      options: this.paginate(
        session,
        this.slotOptions(session, slots, timezone),
        limits,
      ),
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
  // Paginación
  // -------------------------------------------------------------------------

  /**
   * Recorta las opciones de contenido a lo que el canal admite y agrega, en este
   * orden, "Ver más" (si hace falta) y "Cancelar" (siempre).
   */
  private paginate(
    session: BookingSession,
    content: BookingOption[],
    limits?: BookingChannelLimits,
  ): BookingOption[] {
    const window = this.window(content.length, session.pageOffset, limits);
    const page = content.slice(window.start, window.end);

    return [
      ...page,
      ...(window.hasMore
        ? [this.option(session, RESERVED_VALUES.MORE, 'Ver más opciones')]
        : []),
      this.cancelOption(session),
    ];
  }

  private window(total: number, offset: number, limits?: BookingChannelLimits) {
    return computeOptionWindow({
      total,
      offset,
      maxOptionsPerPrompt: limits?.maxOptionsPerPrompt,
      reservedOptions: RESERVED_OPTION_COUNT,
    });
  }

  /**
   * Cantidad de opciones de contenido del paso actual, para poder calcular el
   * salto de página sin volver a construir las etiquetas.
   */
  private async countCurrentStepOptions(
    session: BookingSession,
  ): Promise<number> {
    switch (session.state) {
      case BookingSessionState.ASK_DATE:
        return BOOKING_DATE_HORIZON_DAYS;

      case BookingSessionState.ASK_SERVICE: {
        const services =
          await this.bookingAvailabilityService.getServicesWithAvailability({
            tenantId: session.tenantId,
            date: session.selectedDate ?? '',
          });
        return services.length;
      }

      case BookingSessionState.ASK_STAFF: {
        if (!session.selectedServiceId) return 0;
        const staff = await this.bookingAvailabilityService.getStaffForService({
          tenantId: session.tenantId,
          serviceId: session.selectedServiceId,
        });
        // +1 por "Sin preferencia", que también es contenido paginable.
        return staff.length + 1;
      }

      case BookingSessionState.ASK_SLOT: {
        const slots = await this.loadSlots(session);
        return slots.length;
      }

      default:
        return 0;
    }
  }

  // -------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------

  private dateOptions(
    session: BookingSession,
    timezone: string,
    now: Date,
  ): BookingOption[] {
    const today = todayIsoDateIn(timezone, now);
    const options: BookingOption[] = [];

    for (let offset = 1; offset <= BOOKING_DATE_HORIZON_DAYS; offset += 1) {
      const date = addDaysToIsoDate(today, offset);
      options.push(this.option(session, date, formatDateLabel(date)));
    }

    return options;
  }

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
    return slots.map((slot) =>
      this.option(
        session,
        slot.startTime.toISOString(),
        formatTimeLabel(slot.startTime, timezone),
      ),
    );
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
      timezone: await this.resolveTimezone(tenantId),
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
