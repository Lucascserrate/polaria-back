import { Injectable, Logger } from '@nestjs/common';

import type { Service } from '../../services/entities/service.entity';
import { isSelfBookable } from '../../services/booking-policy';
import type { Staff } from '../../staff/entities/staff.entity';
import { AvailabilityCalculator } from '../availability.calculator';
import { AvailabilityRepository } from '../availability.repository';
import { addMinutes, makeDateInTimeZone } from '../utils/availability.helpers';
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
  buildBookingSlotsForPlans,
  findBookingSlotAt,
  windowOf,
  type BookingSegmentSpec,
  type StaffBusyMap,
} from './slot-builder';
import {
  calculateWorkloadByStaffId,
  resolveStaffForPlan,
  resolveStaffForSlot,
} from './staff-assignment';
import { SchedulingRulesService } from '../../scheduling-rules/scheduling-rules.service';
import {
  buildExecutionPlans,
  pickPlanForAssignment,
} from '../../scheduling-rules/execution-plan';

/**
 * Un servicio de la reserva, tal como lo pidió quien reserva.
 *
 * Es la unidad de todo este módulo, y es una lista y no un campo suelto porque
 * una reserva puede llevar varios servicios encadenados —corte y barba— que el
 * cliente elige juntos. Uno solo es el caso de siempre: WhatsApp, el Flow y el
 * panel mandan un único ítem y nada cambia para ellos.
 */
export type BookingRequestItem = {
  serviceId: string;
  /** Profesional elegido para **este** servicio. Omitirlo es "Sin preferencia". */
  staffId?: string;
};

export type BookingSlotsQuery = {
  tenantId: string;
  /** Fecha en formato YYYY-MM-DD, en la zona horaria del negocio. */
  date: string;
  /**
   * Los servicios de la reserva, **en orden de ejecución**: el primero arranca
   * en el horario ofrecido y los demás van uno detrás del otro.
   *
   * El orden importa y no se reordena acá: es el que el cliente vio en el
   * resumen y el que `planBookingSegments` va a escribir en la cita.
   */
  items: BookingRequestItem[];
  /**
   * Con varios servicios y sin profesional elegido, exige que **una sola
   * persona** pueda con todos.
   *
   * Es el modo por defecto: quien pide un corte y una barba sin elegir a nadie
   * espera que lo atienda alguien, no que lo pasen de silla en silla. Se apaga
   * cuando el cliente pidió expresamente elegir profesional por servicio.
   *
   * Con un solo servicio no cambia nada.
   */
  requireSingleStaff?: boolean;
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
  /**
   * Cada cuánto ofrecer un horario. Ver `DEFAULT_SLOT_STEP_MINUTES`.
   *
   * Lo decide el canal porque es una decisión de **presentación**: depende de
   * cuántos horarios entran en su componente, que el motor no conoce. Omitirlo
   * usa el paso del canal más apretado, que es el que había para todos.
   *
   * Tiene que ser el mismo al listar y al confirmar: el horario elegido se
   * vuelve a buscar contra la grilla, y con un paso más grueso las 09:15 no
   * existirían y la reserva se caería con "ese horario acaba de ocuparse".
   */
  stepMinutes?: number;
};

/**
 * Clave con la que se pide la envolvente del negocio al resolver franjas.
 *
 * No es un profesional: es la forma de reusar el resolver para preguntar por el
 * horario del local, que es lo que resuelve para alguien sin jornada propia.
 */
const BUSINESS_PROBE = '__business__';

/**
 * La primera y la última de un conjunto de fechas `YYYY-MM-DD`.
 *
 * Ese formato ordena alfabéticamente igual que cronológicamente, así que
 * alcanza con ordenar las cadenas. Se asume al menos una fecha.
 */
const extremesOf = (dates: string[]): [string, string] => {
  const sorted = [...dates].sort();
  return [sorted[0], sorted[sorted.length - 1]];
};

/**
 * Un tramo ya resuelto: qué servicio, con quién y entre qué horas.
 *
 * Sale de `confirmSlot` listo para escribirse, y por eso lleva el profesional
 * decidido: "Sin preferencia" se resuelve ahí y no después.
 */
export type ConfirmedSegment = {
  serviceId: string;
  staffId: string;
  startTime: Date;
  endTime: Date;
};

export type SlotConfirmation =
  | {
      available: true;
      startTime: Date;
      /** El final del **bloque**: cuando termina el último servicio. */
      endTime: Date;
      /** En el mismo orden que los servicios pedidos. Nunca vacío. */
      segments: ConfirmedSegment[];
    }
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
    private readonly schedulingRules: SchedulingRulesService,
  ) {}

  /**
   * Todos los horarios disponibles para una reserva y una fecha, sin recortes.
   *
   * Cada horario incluye los profesionales habilitados y libres. Cuando un ítem
   * trae `staffId`, su tramo queda restringido a esa persona; cuando no, es la
   * unión de disponibilidades de todos los que pueden hacer ese servicio.
   *
   * Con varios servicios el horario es el del **bloque entero**, y cuánto dura
   * ese bloque **depende del horario**: si el negocio declaró que dos categorías
   * se atienden a la vez y a esa hora hay dos profesionales libres, la reserva
   * ocupa lo que el más largo de los dos servicios; si a la hora siguiente queda
   * una sola persona, ocupa la suma. Son el mismo pedido resuelto de la única
   * forma que cada momento del día permitía, y por eso la lista puede traer
   * horarios de distinta duración entre sí. Ver `buildExecutionPlans`.
   *
   * Responde una sola pregunta: **qué se puede reservar**. Siempre desde ahora
   * en adelante, para cualquier consumidor. Registrar una atención que ya
   * ocurrió es otra cosa —no hay disponibilidad que consultar sobre el pasado— y
   * no se resuelve relajando este cálculo.
   */
  async getAvailableSlots(query: BookingSlotsQuery): Promise<BookingSlot[]> {
    const context = await this.loadContext(query);
    if (!context) return [];

    return buildBookingSlotsForPlans({
      candidateSlots: context.candidateSlots,
      plans: context.plans,
      requireSingleStaff: context.requireSingleStaff,
      workingRangesByStaff: context.workingRangesByStaff,
      appointmentsByStaff: context.appointmentsByStaff,
      minStartTime: context.minStartTime,
      /*
       * `confirmSlot` no lo pasa, y es a propósito: esa es la revalidación del
       * flujo del cliente, donde un horario que se pasa del cierre no existe.
       * El panel no pasa por ahí —crea con advertencias, ver
       * `collectBookingWarnings`—, así que no hay nada que aflojarle.
       */
      allowEndAfterHours: query.scope === 'panel',
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

    const [businessHours, schedulesByStaff, blocksByStaff] = await Promise.all([
      this.availabilityRepository.getBusinessHours(tenantId),
      this.availabilityRepository.getStaffSchedules(
        staffList.map((staff) => staff.id),
      ),
      this.availabilityRepository.getScheduleBlocksByStaff(
        tenantId,
        timeZone,
        staffList.map((staff) => staff.id),
        date,
      ),
    ]);

    const workingRangesByStaff = resolveWorkingRangesByStaff({
      date,
      timeZone,
      businessHours,
      staff: staffList,
      schedulesByStaff,
      blocksByStaff,
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
          segments: [
            {
              staffIds,
              offsetMinutes: 0,
              durationMinutes: service.durationMinutes,
            },
          ],
          workingRangesByStaff,
          appointmentsByStaff,
          minStartTime,
        }).length > 0
      );
    });
  }

  /**
   * Dónde arranca cada servicio de una reserva, y cuánto dura el bloque.
   *
   * Responde la pregunta que el panel no puede contestar solo: **si estos
   * servicios, con estas personas, se atienden a la vez o uno detrás del otro**.
   * El panel no elige un horario de una lista —elige un instante y un
   * profesional por servicio—, así que sin esto tendría que deducir el reparto
   * por su cuenta, y eso es tener dos versiones de la misma cuenta que
   * inevitablemente se separan: una dibujando el drawer y otra escribiendo la
   * cita.
   *
   * Es puro salvo por dos lecturas —el catálogo y las reglas del negocio—, no
   * mira la agenda y no decide nada sobre disponibilidad. Que las personas
   * asignadas estén libres es otra pregunta, y la contesta `getAvailableSlots`.
   *
   * Un servicio que no existe o está inactivo se ignora en la cuenta y recibe
   * offset `0`: acá no se valida el catálogo, eso ya lo hace quien guarda.
   */
  async resolveBookingLayout(input: {
    tenantId: string;
    /** En orden de ejecución. `staffId` ausente es "todavía sin asignar". */
    items: Array<{ serviceId: string; staffId?: string | null }>;
  }): Promise<{ offsetsMinutes: number[]; totalDurationMinutes: number }> {
    const { tenantId, items } = input;

    if (items.length === 0) {
      return { offsetsMinutes: [], totalDurationMinutes: 0 };
    }

    const services = await this.availabilityRepository.getServices(
      tenantId,
      items.map((item) => item.serviceId),
    );
    const serviceById = new Map(
      services.map((service) => [service.id, service]),
    );

    const parallelPairs = await this.schedulingRules.getParallelPairs(tenantId);

    const plans = buildExecutionPlans({
      services: items.map((item) => {
        const service = serviceById.get(item.serviceId);
        return {
          serviceId: item.serviceId,
          categoryId: service?.categoryId ?? null,
          durationMinutes: service?.durationMinutes ?? 0,
        };
      }),
      canRunInParallel: (categoryAId, categoryBId) =>
        parallelPairs.allows(categoryAId, categoryBId),
    });

    const plan = pickPlanForAssignment(
      plans,
      items.map((item) => item.staffId),
    );

    if (!plan) return { offsetsMinutes: [], totalDurationMinutes: 0 };

    return {
      offsetsMinutes: plan.placements.map(
        (placement) => placement.offsetMinutes,
      ),
      totalDurationMinutes: plan.totalDurationMinutes,
    };
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
   * Las dos listas que necesita el paso de profesional cuando hay varios
   * servicios: quién puede con **todo** y quién puede con **cada uno**.
   *
   * Van juntas y no en dos consultas porque son la misma pregunta hecha con dos
   * recortes, y la pantalla necesita las dos a la vez: la primera para la lista
   * de "un profesional para toda la reserva", la segunda para el paso de
   * elegirlo por servicio. Pedirlas por separado dejaría que una llegue y la
   * otra no, con media pantalla dibujada.
   *
   * `shared` puede venir vacía con `byService` llena, y no es un error: si nadie
   * hace el corte y la barba, la reserva sigue siendo posible repartiéndola. Es
   * exactamente el caso que la pantalla tiene que saber explicar.
   */
  async getStaffForServices(params: {
    tenantId: string;
    /** En el orden en que se van a atender. */
    serviceIds: string[];
  }): Promise<{
    shared: Staff[];
    byService: { serviceId: string; staff: Staff[] }[];
  }> {
    const { tenantId, serviceIds } = params;
    if (serviceIds.length === 0) return { shared: [], byService: [] };

    const [shared, ...lists] = await Promise.all([
      this.availabilityRepository.getStaffList(tenantId, serviceIds),
      ...serviceIds.map((serviceId) =>
        this.availabilityRepository.getStaffList(tenantId, [serviceId]),
      ),
    ]);

    return {
      shared,
      byService: serviceIds.map((serviceId, index) => ({
        serviceId,
        staff: lists[index],
      })),
    };
  }

  /**
   * El equipo que atiende, sin acotar a un servicio.
   *
   * Alimenta la sección "Equipo" de la página pública. Pasa por acá y no por una
   * consulta propia para que sea **la misma regla** que decide quién puede
   * recibir una reserva (`BOOKABLE_STAFF_WHERE`: activo y atiende clientes): un
   * profesional publicado en la página que después no aparece entre las opciones
   * de reserva es peor que no publicarlo.
   */
  getBookableStaff(params: { tenantId: string }): Promise<Staff[]> {
    return this.availabilityRepository.getStaffList(params.tenantId, []);
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
   *
   * **Con varios servicios se pide cobertura para todos**, no para la suma de
   * sus equipos: un día en el que trabaja el barbero pero no la colorista no es
   * un día en el que se pueda reservar corte y color, y ofrecerlo llevaría al
   * "no quedan horarios" que este filtro existe para evitar. Se resuelve
   * intersecando las coberturas, con los horarios y las jornadas cargados una
   * sola vez.
   */
  async getServiceableDates(params: {
    tenantId: string;
    dates: string[];
    /** Vacío busca cobertura de cualquiera del equipo. */
    items?: BookingRequestItem[];
  }): Promise<string[]> {
    const { tenantId, dates } = params;
    if (dates.length === 0) return [];

    const items = params.items?.length ? params.items : [{ serviceId: '' }];

    const tenant = await this.availabilityRepository.getTenant(tenantId);
    const timeZone = tenant?.timezone;
    if (!timeZone) {
      this.logger.warn(`Tenant sin timezone (tenantId=${tenantId}).`);
      return [];
    }

    const staffByItem = await Promise.all(
      items.map((item) =>
        this.availabilityRepository.getStaffList(
          tenantId,
          item.serviceId ? [item.serviceId] : [],
          item.staffId,
        ),
      ),
    );

    if (staffByItem.some((staffList) => staffList.length === 0)) return [];

    const everyone = uniqueStaff(staffByItem.flat());

    const [businessHours, schedulesByStaff, blocksByStaff] = await Promise.all([
      this.availabilityRepository.getBusinessHours(tenantId),
      this.availabilityRepository.getStaffSchedules(
        everyone.map((staff) => staff.id),
      ),
      /*
       * Una sola consulta para todas las fechas, acotada por sus extremos. Se
       * ordenan acá en vez de confiar en que vengan así: son `YYYY-MM-DD`, que
       * ordena alfabéticamente igual que cronológicamente, y un rango invertido
       * traería cero bloqueos sin que nada avisara.
       */
      this.availabilityRepository.getScheduleBlocksByStaff(
        tenantId,
        timeZone,
        everyone.map((staff) => staff.id),
        ...extremesOf(dates),
      ),
    ]);

    /*
     * El mismo piso que usa el armado de horarios. Sin él, un negocio
     * consultado diez minutos antes de cerrar ofrecía "hoy" como día con
     * atención y el paso siguiente contestaba que no quedan horarios: el
     * primer contacto con la reserva era un callejón sin salida.
     */
    const notBefore = this.calculateMinStartTime(timeZone);

    return staffByItem
      .map((staff) =>
        datesWithCoverage({
          dates,
          timeZone,
          businessHours,
          staff,
          schedulesByStaff,
          blocksByStaff,
          notBefore,
        }),
      )
      .reduce((kept, covered) => {
        const set = new Set(covered);
        return kept.filter((date) => set.has(date));
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

    const [businessHours, schedulesByStaff, staffList, busyByStaff, blocks] =
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
        /*
         * Sin repartir entre profesionales: acá el bloqueo no se resta, se
         * cuenta, y para contarlo hay que saber de quién es y por qué.
         */
        this.availabilityRepository.getScheduleBlocks(
          tenantId,
          timeZone,
          staffIds,
          date,
        ),
      ]);

    const staff = staffIds.map((id) => ({
      id,
      usesCustomSchedule:
        staffList.find((member) => member.id === id)?.usesCustomSchedule ??
        false,
    }));

    /*
     * Sin bloqueos, a diferencia de todo lo demás en este archivo, y por lo que
     * separa a las advertencias del motor: el motor descarta lo que no es
     * ofrecible, y esto explica qué tiene de raro lo que el panel pidió igual.
     *
     * Restándolos acá, agendar sobre un bloqueo diría "ese profesional no
     * trabaja a esa hora" —y trabaja— o "el negocio no abre" —y abre—. Un
     * bloqueo no es ausencia de jornada y merece decirlo con sus palabras, que
     * son las de `TIME_BLOCKED`.
     */
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
      blocks,
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
   *
   * Con varios servicios encadenados y sin preferencia, **primero se busca a
   * alguien que pueda con todo** y recién si no lo hay se reparte tramo por
   * tramo. El orden no es una optimización: con `requireSingleStaff` —el modo por
   * defecto— el horario ni siquiera se ofrece si nadie puede solo, así que
   * repartir acá sería contradecir lo que la pantalla mostró.
   *
   * **El reparto se hace sobre el mismo plan que produjo el horario**, no sobre
   * el más conveniente de ahora. El horario que el cliente eligió decía una
   * duración, y esa duración salió de una forma concreta de acomodar los
   * servicios; recalcularla acá podría escribir una cita de dos horas donde se
   * ofreció una de una. Si ese plan ya no se puede cumplir, el horario dejó de
   * estar disponible y se contesta que no, que es lo que el flujo sabe manejar.
   */
  async confirmSlot(
    query: BookingSlotsQuery & { startTime: Date },
  ): Promise<SlotConfirmation> {
    const context = await this.loadContext(query);
    if (!context) return { available: false };

    const slots = buildBookingSlotsForPlans({
      candidateSlots: context.candidateSlots,
      plans: context.plans,
      requireSingleStaff: context.requireSingleStaff,
      workingRangesByStaff: context.workingRangesByStaff,
      appointmentsByStaff: context.appointmentsByStaff,
      minStartTime: context.minStartTime,
    });

    const slot = findBookingSlotAt(slots, query.startTime);
    if (!slot) return { available: false };

    const segments = context.plans[slot.planIndex].segments;

    const workloadByStaffId = calculateWorkloadByStaffId(
      context.appointmentsByStaff,
    );

    /*
     * Uno para toda la reserva mientras sea posible. Da lo mismo con un solo
     * servicio —las dos listas son la misma— y es lo que hace que una reserva de
     * corte y barba no salga con dos personas cuando una alcanza.
     *
     * Con tramos simultáneos la lista llega vacía por construcción —nadie puede
     * con todo si parte de "todo" ocurre al mismo tiempo—, así que esta
     * preferencia se saltea sola y no hace falta preguntarlo aparte.
     */
    const forEverything = resolveStaffForSlot({
      eligibleStaffIds: slot.eligibleStaffIds,
      workloadByStaffId,
    });

    const staffIds =
      forEverything !== null
        ? segments.map(() => forEverything)
        : resolveStaffForPlan({
            segments,
            eligibleStaffIdsBySegment: slot.eligibleStaffIdsBySegment,
            workloadByStaffId,
          });

    if (!staffIds) return { available: false };

    return {
      available: true,
      startTime: slot.startTime,
      endTime: slot.endTime,
      segments: segments.map((segment, index) => {
        const window = windowOf(slot.startTime, segment);

        return {
          serviceId: segment.serviceId,
          staffId: staffIds[index],
          startTime: window.startTime,
          endTime: window.endTime,
        };
      }),
    };
  }

  /**
   * Carga en un solo lugar todo lo que necesitan el cálculo de slots y la
   * asignación de profesional. Devuelve `null` cuando la fecha es inviable
   * (negocio cerrado, servicio inexistente, sin profesionales habilitados).
   */
  private async loadContext(query: BookingSlotsQuery): Promise<{
    candidateSlots: SlotRange[];
    /**
     * Las formas de acomodar la reserva, de la más conveniente a la menos.
     *
     * Siempre al menos una —la encadenada de siempre—, y más de una sólo cuando
     * el negocio declaró que alguna de estas categorías convive con otra.
     */
    plans: { segments: (BookingSegmentSpec & { serviceId: string })[] }[];
    requireSingleStaff: boolean;
    workingRangesByStaff: Record<string, SlotRange[]>;
    appointmentsByStaff: StaffBusyMap;
    /** Ausente en el registro manual: ahí no hay hora mínima que respetar. */
    minStartTime?: Date;
  } | null> {
    const {
      tenantId,
      date,
      items,
      excludeAppointmentId,
      scope = 'client',
      requireSingleStaff = true,
    } = query;

    if (items.length === 0) return null;

    const tenant = await this.availabilityRepository.getTenant(tenantId);
    const timeZone = tenant?.timezone;
    if (!timeZone) {
      this.logger.warn(`Tenant sin timezone (tenantId=${tenantId}).`);
      return null;
    }

    const services = await this.availabilityRepository.getServices(
      tenantId,
      items.map((item) => item.serviceId),
    );
    const serviceById = new Map(
      services.map((service) => [service.id, service]),
    );

    /*
     * Un servicio con consulta previa no tiene horarios **para el cliente**.
     *
     * La regla vive acá y no en cada canal porque `loadContext` es por donde pasan
     * los tres —el flujo de WhatsApp, el Flow y la página pública— tanto para
     * listar horarios como para confirmar uno. Esconder el servicio de la lista de
     * opciones es la comodidad; que su id no rinda ningún horario es lo que hace
     * que sea una regla y no una sugerencia.
     *
     * Con varios servicios alcanza con que uno lo sea para que el bloque entero
     * deje de existir: no se reserva media reserva.
     *
     * `scope === 'panel'` la saltea a propósito: el negocio agenda estos servicios
     * justamente después de la consulta, que es el punto de la política. Ese scope
     * solo llega desde el endpoint autenticado del panel; la página pública manda
     * `'client'` escrito a mano y no puede pedir otra cosa.
     */
    for (const item of items) {
      const service = serviceById.get(item.serviceId);
      if (!service || service.durationMinutes <= 0) return null;
      if (scope === 'client' && !isSelfBookable(service.bookingPolicy)) {
        return null;
      }
    }

    /*
     * Los candidatos habilitados de cada tramo, uno por uno y no en una sola
     * consulta: quien pidió a Jose para el corte no restringe quién puede
     * hacerle la barba, y una lista compartida borraría esa diferencia.
     */
    const staffByItem = await Promise.all(
      items.map((item) =>
        this.availabilityRepository.getStaffList(
          tenantId,
          [item.serviceId],
          item.staffId,
        ),
      ),
    );
    if (staffByItem.some((staffList) => staffList.length === 0)) return null;

    const everyone = uniqueStaff(staffByItem.flat());
    const everyoneIds = everyone.map((staff) => staff.id);

    const [businessHours, schedulesByStaff, blocksByStaff] = await Promise.all([
      this.availabilityRepository.getBusinessHours(tenantId),
      this.availabilityRepository.getStaffSchedules(everyoneIds),
      this.availabilityRepository.getScheduleBlocksByStaff(
        tenantId,
        timeZone,
        everyoneIds,
        date,
      ),
    ]);

    /*
     * Los bloqueos se restan también con `scope === 'panel'`.
     *
     * Esta lista responde "qué horarios hay", y una hora bloqueada no es un
     * horario que haya. Que el panel igual pueda agendar encima no sale de que
     * se la ofrezcan: sale de que crear la reserva advierte en vez de impedir.
     * Ver `collectBookingWarnings`.
     */
    const workingRangesByStaff = resolveWorkingRangesByStaff({
      date,
      timeZone,
      businessHours,
      staff: everyone,
      schedulesByStaff,
      blocksByStaff,
    });

    // Solo siguen los que efectivamente trabajan esa fecha. Esto también cubre
    // el negocio cerrado: con el local sin franjas, nadie queda en pie.
    const worksToday = (id: string) => workingRangesByStaff[id].length > 0;

    const staffIdsByItem = items.map((item, index) =>
      staffByItem[index].map((staff) => staff.id).filter(worksToday),
    );

    if (staffIdsByItem.some((staffIds) => staffIds.length === 0)) return null;

    /*
     * Las reglas del negocio se leen una vez por consulta, aunque la reserva
     * traiga un solo servicio: son pocas filas, y preguntarlas sólo a veces
     * dejaría dos caminos distintos según la cantidad de servicios.
     */
    const parallelPairs = await this.schedulingRules.getParallelPairs(tenantId);

    const executionPlans = buildExecutionPlans({
      services: items.map((item) => {
        const service = serviceById.get(item.serviceId)!;
        return {
          serviceId: item.serviceId,
          categoryId: service.categoryId ?? null,
          durationMinutes: service.durationMinutes,
        };
      }),
      canRunInParallel: (categoryAId, categoryBId) =>
        parallelPairs.allows(categoryAId, categoryBId),
    });

    /*
     * Los candidatos de cada tramo salen del pedido y no del plan: quién puede
     * hacer la pedicure es el mismo dato se atienda a la vez que la manicure o
     * después. Los `placements` vienen en el orden de los ítems, así que la
     * posición alcanza para emparejarlos.
     */
    const plans = executionPlans.map((plan) => ({
      segments: plan.placements.map((placement, index) => ({
        serviceId: placement.serviceId,
        staffIds: staffIdsByItem[index],
        offsetMinutes: placement.offsetMinutes,
        durationMinutes: placement.durationMinutes,
        roundIndex: placement.roundIndex,
      })),
    }));

    const staffIds = everyoneIds.filter(worksToday);

    const appointmentsByStaff =
      await this.availabilityRepository.getAppointmentsByStaff(
        tenantId,
        date,
        timeZone,
        staffIds,
        excludeAppointmentId,
      );

    /*
     * La grilla se arma con la duración del plan **más corto**, que es el
     * primero de la lista.
     *
     * Es el único piso que no deja horarios afuera: cada instante se prueba
     * después contra todos los planes, y el que necesita más tiempo se descarta
     * solo cuando no entra en la jornada de quien lo atendería. Con la duración
     * del plan largo, en cambio, la última hora del día se perdería incluso
     * cuando el corto —dos profesionales a la vez— entraba de sobra.
     */
    const shortestPlanDuration = executionPlans[0].totalDurationMinutes;

    const candidateSlots = this.availabilityCalculator.generateCandidateSlots(
      unionWorkingRanges(workingRangesByStaff, staffIds),
      shortestPlanDuration,
      query.stepMinutes ?? DEFAULT_SLOT_STEP_MINUTES,
      /*
       * El panel genera además los que se pasan del cierre. Que terminen
       * ofreciéndose o no lo decide `buildBookingSlots`, que es quien sabe si
       * alguien los empieza dentro de su jornada: acá sólo se los hace existir.
       */
      scope === 'panel',
    );

    return {
      candidateSlots,
      plans,
      /*
       * Con un solo servicio la bandera no cambia nada —las dos listas de
       * `BookingSlot` son la misma— así que no vale la pena que los tres canales
       * que reservan de a uno tengan que pensarla.
       */
      requireSingleStaff: requireSingleStaff && items.length > 1,
      workingRangesByStaff,
      appointmentsByStaff,
      /*
       * El panel no tiene piso de hora, ninguno.
       *
       * Un horario que ya pasó no se ofrece para reservarlo, se ofrece para
       * registrarlo, y eso vale igual para el martes anterior que para esta
       * mañana: lo que ya ocurrió se carga cuando el negocio tiene un rato, que
       * casi nunca es en el momento. Cortar por la fecha partía esa misma tarea
       * en dos, y obligaba a esperar a mañana para cargar lo de hoy.
       */
      minStartTime:
        scope === 'client' ? this.calculateMinStartTime(timeZone) : undefined,
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

/**
 * Un profesional una sola vez, conservando el orden de aparición.
 *
 * Hace falta porque los candidatos se piden por servicio, y quien hace el corte
 * y la barba vuelve en las dos listas. Cargarle dos veces la jornada y los
 * bloqueos no rompe nada; contarlo dos veces en la cobertura del día, sí.
 */
function uniqueStaff(staffList: Staff[]): Staff[] {
  const seen = new Set<string>();

  return staffList.filter((staff) => {
    if (seen.has(staff.id)) return false;
    seen.add(staff.id);
    return true;
  });
}

function staffIdsForService(staffList: Staff[], serviceId: string): string[] {
  return staffList
    .filter((staff) =>
      (staff.services ?? []).some((service) => service.id === serviceId),
    )
    .map((staff) => staff.id);
}
