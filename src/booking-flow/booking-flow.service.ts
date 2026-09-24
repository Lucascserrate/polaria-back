import { ConflictException, Injectable, Logger } from '@nestjs/common';

import { AppointmentsService } from '../appointments/appointments.service';
import {
  blocksAgenda,
  type Appointment,
} from '../appointments/entities/appointment.entity';
import { SlotAlreadyTakenError } from '../appointments/slot-already-taken.error';
import { BookingAvailabilityService } from '../availability/booking/booking-availability.service';
import {
  FINE_SLOT_STEP_MINUTES,
  type BookingSlot,
} from '../availability/booking/booking-slot.type';
import { ServiceCategoriesService } from '../service-categories/service-categories.service';
import type { Service } from '../services/entities/service.entity';
import { ServicesService } from '../services/services.service';
import { formatServicePrice } from '../services/utils/price-format.util';
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
  CategorySelection,
  hasOptions,
  isTerminalState,
  RESERVED_VALUES,
  StaffPreference,
  type BookingChannelLimits,
  type BookingOption,
  type BookingPrompt,
  type BookingSummary,
  encodeSlotRange,
  decodeSlotRange,
} from './booking-flow.types';
import { encodeSelection } from './booking-payload.codec';
import { BookingSessionService } from './booking-session.service';
import type { BookingSession } from './entities/booking-session.entity';
import { computeOptionWindow } from './option-window';
import {
  groupServices,
  planServiceStep,
  type ServiceGroup,
} from './service-grouping';
import {
  addDaysToIsoDate,
  formatDateLabel,
  formatTimeLabel,
  todayIsoDateIn,
} from './utils/booking-date.util';
import { planSlotScreen } from './slot-ranges';

const DEFAULT_TIMEZONE = 'America/La_Paz';

/** `Cancelar` está siempre presente y por lo tanto siempre ocupa una opción. */
const RESERVED_OPTION_COUNT = 1;

/**
 * Cada cuánto se ofrece un horario por WhatsApp.
 *
 * Fino, como en los demás canales. Acá estuvo en media hora mucho tiempo y no
 * por gusto: con horarios cada cuarto, una jornada de nueve a siete son cuarenta
 * opciones, y en una lista de diez filas eso eran seis páginas —llegar a las
 * 17:00 costaba cinco toques de "Ver más"—. Media hora era el precio que pagaba
 * el negocio por el tamaño del componente: los huecos que no caen en la grilla
 * no se podían ofrecer.
 *
 * Lo que lo destraba es agrupar en tramos (`planSlotScreen`): con eso llegar a
 * cualquier hora del día cuesta un toque, haya veinte horarios o cincuenta. Sin
 * los tramos, bajar el paso acá sería cambiarle un problema por otro.
 */
const SLOT_STEP_MINUTES = FINE_SLOT_STEP_MINUTES;

/** Cómo se llama, para el cliente, el grupo de los que no tienen categoría. */
const UNCATEGORIZED_LABEL = 'Otros servicios';

const BACK_LABEL = 'Volver a las categorías';

/**
 * La pantalla de horarios agrupada no mezcla horarios sueltos con ratos del día.
 *
 * Se probó al revés —tres horarios concretos arriba y los ratos abajo, cada
 * bloque con su encabezado— y se lo probó con gente. Falló de tres maneras, y
 * las tres valen más que el toque que ahorraba:
 *
 * 1. Nadie leyó los encabezados. Los títulos de sección viven **dentro** del
 *    desplegable; lo que se lee es el texto del mensaje, en el chat.
 * 2. La separación se entendió como otro día: "ah, esto ya es de mañana,
 *    entonces no hay más horarios hoy" — y cerraban la lista.
 * 3. Varios leyeron "Próximos horarios" como "los siguientes", que es lo
 *    contrario de lo que decía.
 *
 * Con una sola clase de fila no hay nada que interpretar, y la explicación va
 * donde efectivamente se lee: el cuerpo del mensaje.
 */
const NO_LOOSE_TIMES = 0;

/** "3 servicios", cuando la categoría no trae una descripción propia. */
const countLabel = (count: number): string =>
  count === 1 ? '1 servicio' : `${count} servicios`;

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
    private readonly serviceCategoriesService: ServiceCategoriesService,
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
   * Arranca el flujo. Es lo único que la detección de intención puede disparar:
   * reconoce que el cliente quiere un turno y llama acá, sin aportar ningún dato.
   *
   * La sesión nace con la fecha puesta en **hoy**. En una barbería la mayoría de
   * las reservas son para el mismo día, así que preguntar la fecha por adelantado
   * cobraba un paso al caso frecuente para servir al infrecuente. Quien quiera
   * otro día lo pide desde el paso de horarios.
   */
  async start(params: {
    tenantId: string;
    clientId: string;
    conversationId?: string;
    /**
     * Cita a reemplazar. La reserva corre igual que cualquier otra; lo único que
     * cambia es que al confirmarse cancela la anterior.
     */
    editingAppointmentId?: string;
    limits?: BookingChannelLimits;
    now?: Date;
  }): Promise<BookingPrompt> {
    const now = params.now ?? new Date();
    const timezone = await this.resolveTimezone(params.tenantId);
    const today = todayIsoDateIn(timezone, now);

    const session = await this.bookingSessionService.start({
      tenantId: params.tenantId,
      clientId: params.clientId,
      conversationId: params.conversationId,
      editingAppointmentId: params.editingAppointmentId,
      now,
    });

    /*
     * El primer paso depende del tamaño del catálogo: con pocos servicios se va
     * directo a elegirlo, y solo cuando no entran en una lista se pregunta la
     * categoría primero. Ver `planServiceStep`.
     */
    const plan = await this.serviceStepPlan(params.tenantId, params.limits);

    const ready = await this.bookingSessionService.advance({
      session,
      state:
        plan.kind === 'CATEGORIES'
          ? BookingSessionState.ASK_CATEGORY
          : BookingSessionState.ASK_SERVICE,
      selection: { selectedDate: today },
      now,
    });

    return this.emit(
      ready,
      plan.kind === 'CATEGORIES'
        ? this.categoryPrompt(ready, plan.groups, params.limits)
        : this.servicePrompt(ready, today, plan.services, params.limits),
      now,
    );
  }

  /**
   * Devuelve el prompt, cerrando la sesión si resultó ser un final sin salida.
   *
   * Solo aplica a `NO_AVAILABILITY`, que es el único prompt que corta el flujo sin
   * ofrecer nada que tocar. Deliberadamente **no** cierra ante `STALE`: eso
   * significa que llegó un toque viejo, no que la reserva en curso esté rota, y
   * cerrarla destruiría una sesión perfectamente válida.
   *
   * Sin esta regla, la sesión quedaba abierta en un paso sin botones: la
   * conversación congelada, el texto libre sin interpretar y ni siquiera
   * "Cancelar" para salir, hasta que venciera el TTL.
   */
  private async emit(
    session: BookingSession,
    prompt: BookingPrompt,
    now: Date,
  ): Promise<BookingPrompt> {
    const isDeadEnd = prompt.kind === 'NO_AVAILABILITY';
    if (!isDeadEnd || isTerminalState(session.state)) return prompt;

    this.logger.log(
      `Sesión cerrada por paso sin salida (sessionId=${session.id}, scope=${prompt.scope}).`,
    );
    await this.bookingSessionService.close(
      session,
      BookingSessionState.CANCELLED,
      `NO_AVAILABILITY_${prompt.scope}`,
      now,
    );

    return prompt;
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

    // Si el paso pendiente dejó de tener salida —por ejemplo, el negocio se quedó
    // sin servicios activos a mitad del flujo—, congelar la conversación dejaría
    // al cliente sin nada que tocar. Se cierra la sesión y se le dice por qué.
    if (!hasOptions(current)) {
      return this.emit(refreshed, current, now);
    }

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
        return this.emit(
          session,
          await this.applySelection({
            session,
            value: verdict.value,
            metaMessageId: params.metaMessageId,
            limits: params.limits,
            now,
          }),
          now,
        );
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

    /*
     * "Ver otros horarios" suelta el tramo y vuelve a mostrarlos todos. Tampoco
     * avanza de paso: es la misma pantalla de horarios, sin el recorte.
     */
    if (value === RESERVED_VALUES.ALL_TIMES) {
      const reissued = await this.bookingSessionService.reissue({
        session,
        selection: {
          selectedRangeStart: null,
          selectedRangeEnd: null,
          pageOffset: 0,
        },
        metaMessageId,
        now,
      });

      return this.askSlotPrompt(reissued, limits);
    }

    // "Ver otros días" tampoco avanza: abre el selector de fecha.
    if (value === RESERVED_VALUES.OTHER_DAYS) {
      const advanced = await this.bookingSessionService.advance({
        session,
        state: BookingSessionState.ASK_DATE,
        // El tramo elegido era de otro día: sus instantes ya no dicen nada.
        selection: { selectedRangeStart: null, selectedRangeEnd: null },
        metaMessageId,
        now,
      });
      return this.askDatePrompt(advanced, limits, now);
    }

    switch (session.state) {
      case BookingSessionState.ASK_DATE:
        return this.afterDate({
          session,
          date: value,
          metaMessageId,
          limits,
          now,
        });

      case BookingSessionState.ASK_CATEGORY:
        return this.afterCategory({
          session,
          value,
          metaMessageId,
          limits,
          now,
        });

      case BookingSessionState.ASK_SERVICE:
        // "Volver" no elige servicio: rehace la pregunta anterior con el catálogo
        // entero otra vez a la vista.
        if (value === RESERVED_VALUES.BACK) {
          return this.backToCategories({ session, metaMessageId, limits, now });
        }

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
        return this.afterSlot({ session, value, metaMessageId, limits, now });

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
    const window = this.window(
      total,
      session.pageOffset,
      limits,
      this.extraOptionCount(session),
    );

    const advanced = await this.bookingSessionService.advance({
      session,
      state: session.state,
      selection: { pageOffset: window.hasMore ? window.end : 0 },
      metaMessageId,
      now,
    });

    return this.promptForCurrentState(advanced, limits);
  }

  /** Elegida la fecha, se vuelve a los horarios de ese día. */
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

    return this.askSlotPrompt(advanced, limits);
  }

  private async afterCategory(params: {
    session: BookingSession;
    value: string;
    metaMessageId?: string | null;
    limits?: BookingChannelLimits;
    now: Date;
  }): Promise<BookingPrompt> {
    const { session, value, metaMessageId, limits, now } = params;

    const advanced = await this.bookingSessionService.advance({
      session,
      state: nextStateAfter(BookingSessionState.ASK_CATEGORY),
      selection:
        value === RESERVED_VALUES.UNCATEGORIZED
          ? {
              categorySelection: CategorySelection.UNCATEGORIZED,
              selectedCategoryId: null,
            }
          : {
              categorySelection: CategorySelection.SPECIFIC,
              selectedCategoryId: value,
            },
      metaMessageId,
      now,
    });

    return this.askServicePrompt(advanced, advanced.selectedDate ?? '', limits);
  }

  /**
   * Vuelve del paso de servicios al de categorias.
   *
   * Borra la categoria elegida antes de rehacer la pregunta: dejarla puesta haria
   * que un texto libre en ese momento reenviara la lista de servicios filtrada,
   * que es de lo que el cliente se estaba yendo.
   */
  private async backToCategories(params: {
    session: BookingSession;
    metaMessageId?: string | null;
    limits?: BookingChannelLimits;
    now: Date;
  }): Promise<BookingPrompt> {
    const { session, metaMessageId, limits, now } = params;

    const advanced = await this.bookingSessionService.advance({
      session,
      state: BookingSessionState.ASK_CATEGORY,
      selection: { categorySelection: null, selectedCategoryId: null },
      metaMessageId,
      now,
    });

    return this.askCategoryPrompt(advanced, limits);
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

    // Un servicio sin nadie que lo haga es un problema de configuración del
    // negocio, no de cupo. La sesión la cierra `emit`, que recibe este prompt.
    if (staff.length === 0) {
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
    limits?: BookingChannelLimits;
    now: Date;
  }): Promise<BookingPrompt> {
    const { session, value, metaMessageId, now } = params;

    /*
     * Elegir un tramo no avanza de paso: sigue en los horarios, mirando un rato
     * más chico. Es la misma pantalla con menos opciones, no una etapa nueva —y
     * por eso no hay un estado propio, que habría que sostener en la máquina y
     * en la vuelta atrás de todos los pasos siguientes—.
     */
    const range = decodeSlotRange(value);
    if (range) {
      const inRange = await this.bookingSessionService.reissue({
        session,
        selection: {
          selectedRangeStart: range.from,
          selectedRangeEnd: range.to,
          pageOffset: 0,
        },
        metaMessageId,
        now,
      });

      return this.askSlotPrompt(inRange, params.limits);
    }

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

    /*
     * La cita que se está editando se vuelve a resolver acá, y no se confía en el
     * id guardado en la sesión: entre que el cliente tocó "Reagendar" y este
     * confirmar pudo cancelarla desde otro lado, o el negocio pudo atenderla.
     * `findUpcomingByClientAndId` la busca **por cliente**, así que además es lo
     * que garantiza que nadie termine tocando un turno ajeno.
     */
    const editing = await this.resolveEditingAppointment(session);

    const confirmation = await this.bookingAvailabilityService.confirmSlot({
      tenantId: session.tenantId,
      date: selectedDate,
      items: [
        {
          serviceId: selectedServiceId,
          staffId: session.selectedStaffId ?? undefined,
        },
      ],
      startTime: selectedSlotStart,
      // El mismo paso que al listar, o el horario elegido no existiría en la
      // grilla de la revalidación y saldría "ese horario acaba de ocuparse".
      stepMinutes: SLOT_STEP_MINUTES,
      // La misma exclusión que al listar: lo que se ofreció tiene que poder
      // confirmarse.
      excludeAppointmentId: editing?.id,
    });

    if (!confirmation.available) {
      return this.slotTakenPrompt({ session, metaMessageId, limits, now });
    }

    /*
     * Editando se modifica la cita que ya existe; si no, se crea una nueva. Es la
     * única diferencia entre reagendar y reservar, y termina acá: todo lo
     * anterior —servicio, profesional, horario, revalidación— es el mismo camino.
     *
     * La edición pasa por el mismo mecanismo que usa el panel, así que "cambiar
     * un turno" tiene una sola implementación: valida, replanifica los tramos y
     * los reescribe en una transacción. Antes se creaba una cita nueva y se
     * cancelaba la anterior, lo que le cambiaba el id al turno del cliente y
     * dejaba una ventana con las dos vivas.
     */
    let appointment: Appointment;
    try {
      appointment = editing
        ? await this.applyReschedule({
            session,
            appointmentId: editing.id,
            serviceId: selectedServiceId,
            staffId: confirmation.segments[0].staffId,
            startTime: confirmation.startTime,
          })
        : await this.appointmentsService.createFromBookingFlow({
            tenantId: session.tenantId,
            clientId: session.clientId,
            segments: confirmation.segments,
            startTime: confirmation.startTime,
            endTime: confirmation.endTime,
          });
    } catch (error: unknown) {
      // El índice único es la última barrera: si otro cliente tomó el mismo
      // horario en la ventana entre la revalidación y la escritura, se trata igual
      // que un horario ocupado.
      if (error instanceof SlotAlreadyTakenError || isSlotConflict(error)) {
        this.logger.warn(
          `Carrera perdida por el horario (sessionId=${session.id}): ${describeError(error)}`,
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
    const summary = await this.buildSummary(
      completed,
      confirmation.segments[0].staffId,
    );

    return summary
      ? {
          kind: 'COMPLETED',
          summary,
          appointmentId: appointment.id,
          edited: Boolean(editing),
        }
      : { kind: 'STALE' };
  }

  /**
   * Aplica el reagendamiento sobre la cita que ya existe.
   *
   * Usa el mismo mecanismo que el drawer del panel —`editBookingByTenant`—, así
   * que la validación, la disponibilidad, los precios pactados, la duración
   * vigente y la escritura transaccional viven en un solo lugar. Acá no se decide
   * ninguna regla: se traduce lo que eligió el cliente al estado deseado que ese
   * método espera.
   *
   * El estado deseado lleva un solo servicio porque el flujo de WhatsApp es de un
   * solo servicio. Si la reserva tenía más, quedan afuera; eso ya pasaba con el
   * camino anterior y se registra al resolver la cita.
   *
   * La pertenencia al cliente se validó antes de llegar acá:
   * `editBookingByTenant` es la edición administrativa del negocio y no filtra
   * por cliente.
   */
  private async applyReschedule(params: {
    session: BookingSession;
    appointmentId: string;
    serviceId: string;
    staffId: string;
    startTime: Date;
  }): Promise<Appointment> {
    const { session, appointmentId, serviceId, staffId, startTime } = params;

    await this.appointmentsService.editBookingByTenant(
      appointmentId,
      session.tenantId,
      {
        startTime: startTime.toISOString(),
        items: [{ serviceId, staffId }],
      },
    );

    this.logger.log(
      `Turno reagendado en el lugar (sessionId=${session.id}, appointmentId=${appointmentId}).`,
    );

    const updated = await this.appointmentsService.findUpcomingByClientAndId({
      tenantId: session.tenantId,
      clientId: session.clientId,
      appointmentId,
    });

    // La edición ya ocurrió: si no se puede releer, la cita igual quedó movida.
    if (!updated) {
      throw new Error(
        `No se pudo releer la cita reagendada (appointmentId=${appointmentId}).`,
      );
    }

    return updated;
  }

  /**
   * La cita que esta sesión está editando, si todavía existe y es de este
   * cliente.
   *
   * Devuelve `null` cuando la sesión no está editando nada, cuando la cita ya no
   * está —cancelada o atendida en el medio— o cuando no le pertenece. En esos
   * casos el flujo sigue como una reserva nueva: el cliente eligió un horario y
   * lo que espera es tener turno, no un error sobre una cita que ya no le
   * importa.
   */
  private async resolveEditingAppointment(
    session: BookingSession,
  ): Promise<Appointment | null> {
    const appointmentId = session.editingAppointmentId;
    if (!appointmentId) return null;

    const appointment =
      await this.appointmentsService.findUpcomingByClientAndId({
        tenantId: session.tenantId,
        clientId: session.clientId,
        appointmentId,
      });

    if (!appointment) {
      this.logger.warn(
        `La cita a reagendar ya no está disponible (sessionId=${session.id}, appointmentId=${appointmentId}).`,
      );
      return null;
    }

    /*
     * El estado se comprueba acá y no se delega: `findUpcomingByClientAndId`
     * busca por id y cliente, sin filtrar por estado, así que puede devolver una
     * cita ya atendida o cancelada. La edición rechaza esas con un conflicto que
     * el cliente leería como "ese horario está tomado", que no es lo que pasó.
     */
    if (!blocksAgenda(appointment.status)) {
      this.logger.warn(
        `La cita a reagendar ya no está activa (sessionId=${session.id}, appointmentId=${appointmentId}, status=${appointment.status}).`,
      );
      return null;
    }

    /*
     * El flujo de WhatsApp es de un solo servicio, así que reagendar por acá una
     * reserva de varios deja solo el elegido. Ya pasaba con el camino anterior
     * —creaba una cita de un servicio y cancelaba la de dos—, pero conviene verlo
     * cuando ocurre en lugar de descubrirlo por un reclamo.
     */
    const segments = appointment.services?.length ?? 0;
    if (segments > 1) {
      this.logger.warn(
        `Reagenda por WhatsApp de una reserva con ${segments} servicios: queda con el servicio elegido en el flujo (appointmentId=${appointmentId}).`,
      );
    }

    return appointment;
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
      case BookingSessionState.ASK_DATE:
        return this.askDatePrompt(session, limits, new Date());

      case BookingSessionState.ASK_CATEGORY:
        return this.askCategoryPrompt(session, limits);

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
        await this.dateOptions(session, timezone, now),
        limits,
      ),
    };
  }

  /**
   * El catálogo que el cliente puede elegir, y cómo hay que mostrárselo.
   *
   * Solo los servicios que el cliente puede reservar solo. Uno con consulta
   * previa no rinde horarios en este canal —lo corta `loadContext`—, así que
   * ofrecerlo sería llevarlo a un paso que termina en "no hay horarios" sin
   * explicar por qué. Por lo mismo, una categoría cuyos servicios son todos de
   * consulta previa no aparece: no queda nada adentro.
   */
  private async serviceStepPlan(
    tenantId: string,
    limits?: BookingChannelLimits,
  ) {
    const [services, categories] = await Promise.all([
      this.servicesService.findSelfBookableByTenant(tenantId),
      this.serviceCategoriesService.findByTenant(tenantId),
    ]);

    return planServiceStep({
      services,
      categories,
      maxOptionsPerPrompt: limits?.maxOptionsPerPrompt,
      reservedOptions: RESERVED_OPTION_COUNT,
    });
  }

  private async askCategoryPrompt(
    session: BookingSession,
    limits?: BookingChannelLimits,
  ): Promise<BookingPrompt> {
    const plan = await this.serviceStepPlan(session.tenantId, limits);

    /*
     * El catálogo encogió mientras la sesión estaba abierta y ya entra en una
     * lista: se saltea la pregunta en vez de mostrar una con una sola respuesta
     * posible.
     */
    if (plan.kind === 'SERVICES') {
      return this.servicePrompt(
        session,
        session.selectedDate ?? '',
        plan.services,
        limits,
      );
    }

    return this.categoryPrompt(session, plan.groups, limits);
  }

  private categoryPrompt(
    session: BookingSession,
    groups: Array<ServiceGroup<Service>>,
    limits?: BookingChannelLimits,
  ): BookingPrompt {
    return {
      kind: 'ASK_CATEGORY',
      options: this.paginate(
        session,
        groups.map((group) =>
          this.option(
            session,
            group.category?.id ?? RESERVED_VALUES.UNCATEGORIZED,
            group.category?.name ?? UNCATEGORIZED_LABEL,
            /*
             * La descripción de la categoría si el negocio la escribió, y si no
             * cuántos servicios tiene. Las dos contestan lo mismo —qué voy a
             * encontrar acá adentro— y la escrita lo hace mejor, pero una lista
             * de nombres a secas obliga a entrar para averiguarlo.
             */
            group.category?.description ?? countLabel(group.services.length),
          ),
        ),
        limits,
      ),
    };
  }

  /**
   * Catálogo del negocio, o la parte de él que el cliente pidió ver.
   *
   * Lista **todos** los servicios activos, sin filtrar por disponibilidad de la
   * fecha. Ese filtro existía cuando la fecha se elegía primero y servía para
   * evitar callejones sin salida; con la fecha puesta en hoy por defecto, filtrar
   * acá dejaba el primer paso vacío cada vez que hoy no tenía cupo —incluido un
   * negocio recién creado sin horarios cargados—, que es justamente el callejón
   * que se quería evitar. Ahora la falta de cupo se descubre en el paso de
   * horarios, que sí ofrece salida.
   */
  private async askServicePrompt(
    session: BookingSession,
    date: string,
    limits?: BookingChannelLimits,
  ): Promise<BookingPrompt> {
    return this.servicePrompt(
      session,
      date,
      await this.servicesForSession(session),
      limits,
    );
  }

  private servicePrompt(
    session: BookingSession,
    date: string,
    services: Service[],
    limits?: BookingChannelLimits,
  ): BookingPrompt {
    if (services.length === 0) {
      return { kind: 'NO_AVAILABILITY', scope: 'SETUP' };
    }

    // La descripción muestra el precio y no la duración: los minutos son un dato
    // nuestro, el precio es lo que el cliente necesita para elegir.
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
            formatServicePrice(service.price, service.currency),
          ),
        ),
        limits,
        // Solo cuando hubo categorías: sin ellas no hay a dónde volver.
        session.categorySelection
          ? [this.option(session, RESERVED_VALUES.BACK, BACK_LABEL)]
          : [],
      ),
    };
  }

  /**
   * Los servicios que corresponden a la categoría elegida, o todos.
   *
   * Si el filtro no deja nada se devuelve el catálogo entero. Pasa cuando el
   * negocio borra una categoría, o pasa sus servicios a consulta previa, con una
   * sesión abierta parada justo ahí: el cliente tocó una fila que ya no tiene
   * contenido. Entre mostrarle todo y dejarlo sin nada que tocar, lo primero: la
   * invariante del flujo es que una sesión abierta siempre ofrece salida.
   */
  private async servicesForSession(
    session: BookingSession,
  ): Promise<Service[]> {
    const services = await this.servicesService.findSelfBookableByTenant(
      session.tenantId,
    );

    if (!session.categorySelection) return services;

    const filtered = services.filter((service) =>
      session.categorySelection === CategorySelection.UNCATEGORIZED
        ? !service.categoryId
        : service.categoryId === session.selectedCategoryId,
    );

    return filtered.length > 0 ? filtered : services;
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

  /**
   * Horarios de la fecha en curso.
   *
   * Un día sin cupo **no es un callejón sin salida**: el paso se muestra igual, con
   * "Ver otros días" como única alternativa. Por eso desapareció el filtro previo
   * de servicios por disponibilidad de la fecha: ya no hace falta anticipar el
   * vacío si el vacío ofrece su propia salida.
   */
  private async askSlotPrompt(
    session: BookingSession,
    limits?: BookingChannelLimits,
  ): Promise<BookingPrompt> {
    const all = await this.loadSlots(session);
    const timezone = await this.resolveTimezone(session.tenantId);

    if (all.length === 0) {
      return {
        kind: 'ASK_SLOT',
        date: session.selectedDate ?? '',
        hasSlots: false,
        options: [this.otherDaysOption(session), this.cancelOption(session)],
      };
    }

    const empty = {
      kind: 'ASK_SLOT' as const,
      date: session.selectedDate ?? '',
    };

    /*
     * Ya eligió un tramo: se le muestran sus horarios, con la vuelta a la lista
     * de tramos en lugar de "ver otros días" —a otro día se llega volviendo—.
     *
     * Los horarios se recalculan contra disponibilidad fresca y se recortan al
     * tramo: lo que el cliente eligió fue mirar ese rato, no congelar lo que
     * había. Si mientras tanto se ocupó todo, se lo devuelve a los tramos en vez
     * de dejarlo mirando una lista vacía.
     */
    const chosen = this.slotsInChosenRange(session, all);
    if (chosen) {
      if (chosen.slots.length === 0) {
        const back = await this.bookingSessionService.reissue({
          session,
          selection: { selectedRangeStart: null, selectedRangeEnd: null },
          now: new Date(),
        });
        return this.askSlotPrompt(back, limits);
      }

      return {
        ...empty,
        hasSlots: true,
        range: {
          from: formatTimeLabel(chosen.from, timezone),
          to: formatTimeLabel(chosen.to, timezone),
        },
        options: this.paginate(
          session,
          this.slotOptions(session, chosen.slots, timezone),
          limits,
          [this.allTimesOption(session)],
        ),
      };
    }

    /*
     * Cuántos horarios entran, según lo que el canal deja. Los dos límites salen
     * de las filas fijas de cada pantalla y no de un número escrito a mano: el
     * día que el paso sume una opción, esto se reajusta solo en lugar de empezar
     * a producir listas que WhatsApp rechaza.
     */
    const rows = limits?.maxOptionsPerPrompt;
    const screen = planSlotScreen({
      slots: all,
      maxNext: NO_LOOSE_TIMES,
      // Acá van "Ver otros días" y "Cancelar".
      screenRows: (rows ?? all.length + 2) - RESERVED_OPTION_COUNT - 1,
      // En la pantalla de un tramo van "Ver otros horarios" y "Cancelar".
      rangeCapacity: (rows ?? all.length + 2) - RESERVED_OPTION_COUNT - 1,
    });

    if (screen.kind === 'all') {
      return {
        ...empty,
        hasSlots: true,
        options: this.paginate(
          session,
          this.slotOptions(session, all, timezone),
          limits,
          [this.otherDaysOption(session)],
        ),
      };
    }

    return {
      ...empty,
      hasSlots: true,
      grouped: true,
      options: [
        ...screen.ranges.map((range) =>
          this.rangeOption(session, range, timezone),
        ),
        this.otherDaysOption(session),
        this.cancelOption(session),
      ],
    };
  }

  /**
   * Los horarios del tramo elegido, o `null` si no eligió ninguno.
   *
   * El recorte es por instante y no por posición, que es la razón de guardar el
   * tramo y no cuál era: entre que se dibujó la lista y el cliente eligió, los
   * tramos pueden haberse recalculado.
   */
  private slotsInChosenRange(
    session: BookingSession,
    slots: BookingSlot[],
  ): { from: Date; to: Date; slots: BookingSlot[] } | null {
    const { selectedRangeStart: from, selectedRangeEnd: to } = session;
    if (!from || !to) return null;

    return {
      from,
      to,
      slots: slots.filter((slot) => {
        const at = slot.startTime.getTime();
        return at >= from.getTime() && at <= to.getTime();
      }),
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
    extraOptions: BookingOption[] = [],
  ): BookingOption[] {
    const window = this.window(
      content.length,
      session.pageOffset,
      limits,
      extraOptions.length,
    );
    const page = content.slice(window.start, window.end);

    return [
      ...page,
      ...(window.hasMore
        ? [this.option(session, RESERVED_VALUES.MORE, 'Ver más opciones')]
        : []),
      ...extraOptions,
      this.cancelOption(session),
    ];
  }

  /**
   * `extraOptions` son filas fijas del paso, como "Ver otros días". Ocupan lugar
   * en el componente igual que `Cancelar`, así que entran en la reserva.
   */
  private window(
    total: number,
    offset: number,
    limits?: BookingChannelLimits,
    extraOptionCount = 0,
  ) {
    return computeOptionWindow({
      total,
      offset,
      maxOptionsPerPrompt: limits?.maxOptionsPerPrompt,
      reservedOptions: RESERVED_OPTION_COUNT + extraOptionCount,
    });
  }

  /**
   * Filas fijas que el paso actual agrega además de `Cancelar`.
   *
   * El salto de página tiene que descontarlas igual que las descontó el dibujo,
   * porque las dos cuentas reparten el mismo presupuesto de filas. Sin esto, un
   * paso con fila extra avanzaba el offset una opción más de las que llegó a
   * mostrar y se salteaba un horario: la lista terminaba en el séptimo y la
   * página siguiente arrancaba en el noveno.
   */
  private extraOptionCount(session: BookingSession): number {
    switch (session.state) {
      // "Ver otros días", en `askSlotPrompt`.
      case BookingSessionState.ASK_SLOT:
        return 1;

      // "Volver a las categorías", solo cuando hubo paso de categorías.
      case BookingSessionState.ASK_SERVICE:
        return session.categorySelection ? 1 : 0;

      default:
        return 0;
    }
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

      case BookingSessionState.ASK_CATEGORY: {
        const [services, categories] = await Promise.all([
          this.servicesService.findSelfBookableByTenant(session.tenantId),
          this.serviceCategoriesService.findByTenant(session.tenantId),
        ]);
        return groupServices(services, categories).length;
      }

      case BookingSessionState.ASK_SERVICE:
        // La misma lista que se ofreció, con el filtro de categoría puesto: si
        // contara todo el catálogo, un número válido para el cliente quedaría
        // fuera de rango o al revés.
        return (await this.servicesForSession(session)).length;

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

  /**
   * Los próximos días que el negocio atiende.
   *
   * Se ofrecen solo los días con cobertura real: un domingo cerrado, o un día en
   * que no trabaja nadie del equipo, no es una opción. Antes se listaban los
   * catorce días siguientes sin mirar nada, y elegir uno cerrado devolvía "no
   * quedan horarios" para un día en que el local ni abre.
   *
   * El servicio y el profesional ya elegidos acotan la pregunta: si el cliente
   * pidió a alguien en particular, los días que ese alguien no trabaja tampoco
   * sirven.
   */
  private async dateOptions(
    session: BookingSession,
    timezone: string,
    now: Date,
  ): Promise<BookingOption[]> {
    const today = todayIsoDateIn(timezone, now);

    const horizon = Array.from({ length: BOOKING_DATE_HORIZON_DAYS }, (_, i) =>
      addDaysToIsoDate(today, i + 1),
    );

    const dates = await this.bookingAvailabilityService.getServiceableDates({
      tenantId: session.tenantId,
      dates: horizon,
      items: session.selectedServiceId
        ? [
            {
              serviceId: session.selectedServiceId,
              staffId: session.selectedStaffId ?? undefined,
            },
          ]
        : [],
    });

    return dates.map((date) =>
      this.option(session, date, formatDateLabel(date)),
    );
  }

  private loadSlots(session: BookingSession): Promise<BookingSlot[]> {
    if (!session.selectedDate || !session.selectedServiceId) {
      return Promise.resolve([]);
    }

    return this.bookingAvailabilityService.getAvailableSlots({
      tenantId: session.tenantId,
      date: session.selectedDate,
      items: [
        {
          serviceId: session.selectedServiceId,
          staffId: session.selectedStaffId ?? undefined,
        },
      ],
      stepMinutes: SLOT_STEP_MINUTES,
      /*
       * Reagendando, la propia cita no cuenta como ocupada. Sin esto, mover un
       * turno de 18:00 a 18:15 no aparece siquiera como opción: sus propios
       * treinta minutos tapan el horario nuevo, y el cliente concluye que no hay
       * lugar cuando el lugar es el suyo.
       */
      excludeAppointmentId: session.editingAppointmentId ?? undefined,
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

  /** Desvío al selector de fecha, disponible en el paso de horarios. */
  private otherDaysOption(session: BookingSession): BookingOption {
    return this.option(session, RESERVED_VALUES.OTHER_DAYS, 'Ver otros días');
  }

  /** Vuelve de los horarios de un tramo a la lista de tramos. */
  private allTimesOption(session: BookingSession): BookingOption {
    return this.option(
      session,
      RESERVED_VALUES.ALL_TIMES,
      'Ver otros horarios',
    );
  }

  /**
   * Un tramo del día: "13:00 a 15:30 · 6 horarios".
   *
   * La etiqueta es **literal** —del primero al último horario que hay adentro— y
   * no un rango redondeado. Así no promete un rato que no existe, y el subtítulo
   * con el conteo evita que elegir un tramo sea elegir a ciegas: sin él, entrar y
   * encontrar un solo horario se siente a engaño.
   */
  private rangeOption(
    session: BookingSession,
    range: BookingSlot[],
    timezone: string,
  ): BookingOption {
    const from = range[0].startTime;
    const to = range[range.length - 1].startTime;

    return {
      selectionId: encodeSelection({
        token: session.token,
        stepVersion: session.stepVersion,
        state: session.state,
        value: encodeSlotRange(from, to),
      }),
      title: `${formatTimeLabel(from, timezone)} a ${formatTimeLabel(to, timezone)}`,
      description:
        range.length === 1 ? '1 horario' : `${range.length} horarios`,
    };
  }

  private async resolveTimezone(tenantId: string): Promise<string> {
    const tenant = await this.tenantsService.findOne(tenantId);
    return tenant?.timezone ?? DEFAULT_TIMEZONE;
  }
}

/**
 * Si el error dice "ese horario está tomado".
 *
 * La creación lo señala con `SlotAlreadyTakenError`; la edición, que pasa por el
 * mecanismo del panel, lo traduce a un `ConflictException` con el motivo adentro.
 * Los dos significan lo mismo para el cliente, y los dos tienen que llevarlo a la
 * lista fresca de horarios en lugar de a un error.
 */
function isSlotConflict(error: unknown): boolean {
  return error instanceof ConflictException;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
