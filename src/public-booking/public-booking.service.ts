import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AppointmentsService } from '../appointments/appointments.service';
import { SlotAlreadyTakenError } from '../appointments/slot-already-taken.error';
import { BookingAvailabilityService } from '../availability/booking/booking-availability.service';
import { currentDateInTimeZone } from '../availability/utils/availability.helpers';
import { resolveBusinessStatus } from '../business_hours/business-status';
import { BusinessHoursService } from '../business_hours/business_hours.service';
import { ClientsService } from '../clients/clients.service';
import { ClientSource } from '../clients/entities/client.entity';
import { ServiceCategoriesService } from '../service-categories/service-categories.service';
import { ServicesService } from '../services/services.service';
import { BusinessPhotosService } from '../business-photos/business-photos.service';
import { CustomerAccountsService } from '../customer-accounts/customer-accounts.service';
import {
  CONSULTATION_FIRST_NOTICE,
  isSelfBookable,
} from '../services/booking-policy';
import { toPrice } from '../services/quoted-price';
import { dialCodeForTimeZone } from '../tenants/dial-code';
import { TenantsService } from '../tenants/tenants.service';
import type { Staff } from '../staff/entities/staff.entity';
import type { Tenant } from '../tenants/entities/tenant.entity';
import type { BookingRequestItem } from '../availability/booking/booking-availability.service';
import { ANY_STAFF } from './dto/booking-selection';
import { FINE_SLOT_STEP_MINUTES } from '../availability/booking/booking-slot.type';
import type {
  PublicBookingConfirmation,
  PublicBookingStaff,
  PublicBusinessProfile,
  PublicSlot,
  PublicStaff,
} from './public-booking.types';

/**
 * Un profesional, recortado a lo publicable.
 *
 * Uno solo para el paso de reserva y para la sección "Equipo": si cada uno
 * armara su objeto, agregar un campo en un lado y olvidarlo en el otro haría
 * que el mismo profesional se viera distinto en dos pantallas de la misma
 * página. Y lo que **no** entra —correo, rol, comisión, jornada— no entra una
 * sola vez.
 */
const toPublicStaff = (member: Staff): PublicStaff => ({
  id: member.id,
  name: member.name,
  jobTitle: member.jobTitle ?? null,
  photoUrl: member.photoUrl ?? null,
});

/**
 * Todo lo que puede pedir alguien que no inició sesión.
 *
 * Es una capa de traducción, no un motor: resuelve el negocio por su slug,
 * llama a los mismos servicios que usan el panel y WhatsApp, y recorta la
 * respuesta a lo publicable. **No decide disponibilidad ni escribe citas por su
 * cuenta.** Si un horario está libre lo dice `BookingAvailabilityService`, y si
 * una cita se crea la crea `AppointmentsService.createFromBookingFlow`, que es
 * exactamente el camino de la reserva guiada de WhatsApp.
 *
 * Ésa es la regla del módulo: acá no puede aparecer una segunda versión de una
 * regla de reserva. Un horario no puede estar libre en la página y ocupado en
 * el panel.
 */
@Injectable()
export class PublicBookingService {
  private readonly logger = new Logger(PublicBookingService.name);

  constructor(
    private readonly tenantsService: TenantsService,
    private readonly servicesService: ServicesService,
    private readonly serviceCategoriesService: ServiceCategoriesService,
    private readonly businessPhotosService: BusinessPhotosService,
    private readonly customerAccountsService: CustomerAccountsService,
    private readonly businessHoursService: BusinessHoursService,
    private readonly bookingAvailabilityService: BookingAvailabilityService,
    private readonly clientsService: ClientsService,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  async getProfile(slug: string): Promise<PublicBusinessProfile> {
    const tenant = await this.resolveTenant(slug);

    const [services, categories, businessHours, photos, portfolio, team] =
      await Promise.all([
        this.servicesService.findActiveByTenant(tenant.id),
        this.serviceCategoriesService.findByTenant(tenant.id),
        this.businessHoursService.getTenantSchedule(tenant.id),
        this.businessPhotosService.list(tenant.id, 'gallery'),
        this.businessPhotosService.list(tenant.id, 'portfolio'),
        this.bookingAvailabilityService.getBookableStaff({
          tenantId: tenant.id,
        }),
      ]);

    return {
      slug: tenant.slug as string,
      name: tenant.name,
      businessType: tenant.businessType ?? null,
      logoUrl: tenant.logoUrl,
      photos,
      portfolio,
      team: team.map(toPublicStaff),
      timezone: tenant.timezone,
      currency: tenant.currency,
      dialCode: dialCodeForTimeZone(tenant.timezone),
      address: tenant.address,
      location:
        typeof tenant.latitude === 'number' &&
        typeof tenant.longitude === 'number'
          ? { latitude: tenant.latitude, longitude: tenant.longitude }
          : null,
      status: resolveBusinessStatus({
        businessHours,
        timeZone: tenant.timezone,
        now: new Date(),
      }),
      businessHours,
      /*
       * Todos los servicios activos, sin filtrar por quién los hace. Es lo mismo
       * que ofrece la reserva por WhatsApp: un servicio sin profesional asignado
       * se descubre en el paso de horarios, que sí tiene salida. Filtrarlo acá
       * sería una segunda regla sobre qué se puede reservar, distinta de la que
       * ya rige en el otro canal.
       */
      /*
       * Solo las categorías que tienen algo adentro. Una vacía sería un filtro
       * que lleva a una lista sin servicios: en el panel se muestra a propósito
       * —es la que hay que llenar—, pero acá el que mira es el cliente.
       */
      categories: categories
        .filter((category) =>
          services.some((service) => service.categoryId === category.id),
        )
        .map((category) => ({
          id: category.id,
          name: category.name,
          description: category.description ?? null,
        })),
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        categoryId: service.categoryId ?? null,
        description: service.description ?? null,
        price: toPrice(service.price),
        currency: service.currency,
        durationMinutes: service.durationMinutes,
        selfBookable: isSelfBookable(service.bookingPolicy),
      })),
    };
  }

  /**
   * Quién puede atender lo elegido: la lista de "toda la reserva" y la de cada
   * servicio.
   *
   * Alimenta el paso de "elegir profesional", que la página se saltea cuando
   * `shared` devuelve uno solo: preguntar entre una única opción no es una
   * elección. `byService` es lo que sostiene el paso de elegirlo servicio por
   * servicio, y llega en la misma respuesta porque la pantalla ofrece las dos
   * cosas a la vez.
   */
  async getStaff(
    slug: string,
    serviceIds: string[],
  ): Promise<PublicBookingStaff> {
    const tenant = await this.resolveTenant(slug);

    const { shared, byService } =
      await this.bookingAvailabilityService.getStaffForServices({
        tenantId: tenant.id,
        serviceIds,
      });

    return {
      shared: shared.map(toPublicStaff),
      byService: byService.map((entry) => ({
        serviceId: entry.serviceId,
        staff: entry.staff.map(toPublicStaff),
      })),
    };
  }

  async getSlots(
    slug: string,
    query: { date: string; serviceIds: string[]; staffIds?: string[] },
  ): Promise<PublicSlot[]> {
    const tenant = await this.resolveTenant(slug);

    const slots = await this.bookingAvailabilityService.getAvailableSlots({
      tenantId: tenant.id,
      date: query.date,
      ...this.toBookingRequest(query),
      /*
       * Siempre `client`, y no es configurable desde afuera: el `panel` existe
       * para que el dueño registre lo que ya ocurrió, y una página pública que
       * pudiera pedirlo ofrecería turnos en el pasado.
       */
      scope: 'client',
    });

    return slots.map((slot) => ({
      startTime: slot.startTime.toISOString(),
      endTime: slot.endTime.toISOString(),
    }));
  }

  /**
   * De los próximos días, los que el negocio atiende.
   *
   * Es lo que decide qué fechas se pueden tocar en el selector. No mira la
   * agenda —un día abierto pero completo sigue apareciendo— porque ésa es otra
   * pregunta, y ya tiene su propia respuesta en el paso de horarios.
   */
  async getServiceableDays(
    slug: string,
    query: { serviceIds: string[]; staffIds?: string[]; days?: number },
  ): Promise<string[]> {
    const tenant = await this.resolveTenant(slug);

    const today = currentDateInTimeZone(tenant.timezone, new Date());
    const dates = nextDates(today, query.days ?? 30);

    return this.bookingAvailabilityService.getServiceableDates({
      tenantId: tenant.id,
      dates,
      items: this.toBookingRequest(query).items,
    });
  }

  /**
   * Traduce lo que viaja en la URL —dos listas paralelas— a la forma con la que
   * el motor razona: un ítem por servicio, con su profesional si lo hay.
   *
   * Las dos listas se emparejan **por posición**, así que una desalineada es un
   * 400 y no un silencio: con `staffIds` más corta, el último servicio saldría
   * con "cualquiera" sin que nadie lo haya pedido, y quien eligió a Jose para el
   * corte se enteraría el día del turno.
   *
   * Sin `staffIds` la reserva es "cualquier profesional", y ahí se pide que
   * **una sola persona** pueda con todo: quien no eligió a nadie no está
   * pidiendo que lo pasen de silla en silla.
   *
   * Con `staffIds` llena de `cualquiera` la respuesta es otra, y no es una
   * sutileza: ésa es la pantalla de repartir, donde el cliente pidió
   * expresamente que cada servicio se resuelva por su cuenta. Ver `ANY_STAFF`.
   */
  private toBookingRequest(query: {
    serviceIds: string[];
    staffIds?: string[];
  }): {
    items: BookingRequestItem[];
    requireSingleStaff: boolean;
    stepMinutes: number;
  } {
    const { serviceIds, staffIds } = query;

    if (new Set(serviceIds).size !== serviceIds.length) {
      throw new BadRequestException('Hay un servicio repetido en la reserva');
    }

    if (staffIds && staffIds.length !== serviceIds.length) {
      throw new BadRequestException(
        'Falta el profesional de alguno de los servicios',
      );
    }

    return {
      items: serviceIds.map((serviceId, index) => {
        const staffId = staffIds?.[index];

        return {
          serviceId,
          staffId: staffId && staffId !== ANY_STAFF ? staffId : undefined,
        };
      }),
      requireSingleStaff: !staffIds,
      /*
       * El paso va acá y no en cada consulta a propósito: listar horarios y
       * confirmar uno tienen que usar el mismo, y con dos lugares para
       * escribirlo es cuestión de tiempo que queden distintos. Con pasos
       * distintos, un horario que se ofreció no existiría al confirmarlo y la
       * reserva se caería con "ese horario acaba de ocuparse".
       *
       * La página muestra los horarios en una grilla de chips, sin el tope de
       * filas de una lista de WhatsApp.
       */
      stepMinutes: FINE_SLOT_STEP_MINUTES,
    };
  }

  /**
   * Crea la reserva pedida desde la página.
   *
   * Los tres pasos son los mismos que los de WhatsApp y en el mismo orden:
   * revalidar el horario, resolver quién es el cliente, escribir la cita. El
   * horario se revalida **siempre**, porque entre que la página mostró la lista
   * y el cliente tocó "Confirmar" otro pudo tomarlo: no existen reservas
   * temporales, y ésta es la única barrera antes del índice único.
   */
  async createBooking(
    slug: string,
    input: {
      serviceIds: string[];
      staffIds?: string[];
      startTime: string;
      customerName?: string;
      customerPhone?: string;
    },
    customerAccountId?: string | null,
  ): Promise<PublicBookingConfirmation> {
    const tenant = await this.resolveTenant(slug);

    const startTime = new Date(input.startTime);
    if (Number.isNaN(startTime.getTime())) {
      throw new BadRequestException('startTime inválido');
    }

    const request = this.toBookingRequest(input);

    /*
     * Los servicios se traen en el orden pedido, que es el orden en que se van a
     * atender y el que el cliente vio en el resumen.
     */
    const services = await Promise.all(
      input.serviceIds.map((serviceId) =>
        this.servicesService.findOneByTenant(serviceId, tenant.id),
      ),
    );

    if (services.some((service) => !service || !service.isActive)) {
      throw new NotFoundException('El servicio ya no está disponible');
    }

    const chosen = services as NonNullable<(typeof services)[number]>[];

    /*
     * El rechazo es explícito y no un "no hay horarios".
     *
     * `loadContext` ya corta este caso, pero devolvería que el horario no está
     * disponible, y eso manda al cliente a probar otro día por algo que ningún día
     * va a resolver. Acá sabemos el motivo, así que se dice.
     *
     * Con varios servicios alcanza con que uno lo requiera: no se reserva media
     * reserva.
     */
    if (chosen.some((service) => !isSelfBookable(service.bookingPolicy))) {
      throw new BadRequestException(CONSULTATION_FIRST_NOTICE);
    }

    const confirmation = await this.bookingAvailabilityService.confirmSlot({
      tenantId: tenant.id,
      /*
       * La fecha se deriva del instante en la zona del negocio, no de la del
       * navegador: quien reserva desde otro país manda el mismo instante y tiene
       * que caer en el mismo día de la agenda.
       */
      date: currentDateInTimeZone(tenant.timezone, startTime),
      ...request,
      startTime,
      scope: 'client',
    });

    if (!confirmation.available) {
      throw new ConflictException(SLOT_TAKEN_MESSAGE);
    }

    /*
     * El teléfono lo normaliza el resolver, no esta página. Es lo que hace que
     * quien reserva acá y quien escribe por WhatsApp sean el mismo cliente: si
     * cada canal normalizara por su cuenta, alcanzaría con que uno lo hiciera
     * distinto para partirle el historial. Un número ilegible sale de acá como
     * un 400 con el motivo, igual que antes.
     */
    const account = customerAccountId
      ? await this.customerAccountsService.findById(customerAccountId)
      : null;

    /*
     * Con cuenta pero sin teléfono no se puede reservar, y no es un caso raro:
     * Google no da el número, así que toda cuenta nace sin él. La página lo pide
     * una vez antes de llegar hasta acá; este 400 es la red por si no lo hizo.
     */
    if (account && !account.phone) {
      throw new BadRequestException(
        'Agregá tu número de teléfono para confirmar la reserva.',
      );
    }

    if (!account && !(input.customerName && input.customerPhone)) {
      throw new BadRequestException(
        'Faltan el nombre y el teléfono, o iniciar sesión.',
      );
    }

    /*
     * El teléfono lo normaliza el resolver, no esta página. Es lo que hace que
     * quien reserva acá y quien escribe por WhatsApp sean el mismo cliente: si
     * cada canal normalizara por su cuenta, alcanzaría con que uno lo hiciera
     * distinto para partirle el historial. Un número ilegible sale de acá como
     * un 400 con el motivo, igual que antes.
     *
     * El de la cuenta entra como `account` y no como `typed` porque ya está
     * canónico —se guardó pasando por la misma función— y volver a interpretarlo
     * contra el prefijo del negocio le agregaría el código de país dos veces.
     */
    const client = await this.clientsService.resolveByPhone({
      tenantId: tenant.id,
      phone: account?.phone
        ? { kind: 'account', value: account.phone }
        : {
            kind: 'typed',
            value: input.customerPhone ?? '',
            dialCode: dialCodeForTimeZone(tenant.timezone),
          },
      name: (account?.name ?? input.customerName ?? '').trim(),
      source: ClientSource.WEB,
    });

    try {
      const appointment = await this.appointmentsService.createFromBookingFlow({
        tenantId: tenant.id,
        clientId: client.id,
        customerAccountId: account?.id ?? null,
        segments: confirmation.segments,
        startTime: confirmation.startTime,
        endTime: confirmation.endTime,
      });

      const staffNames = await this.resolveStaffNames(tenant.id);
      const serviceById = new Map(
        chosen.map((service) => [service.id, service]),
      );

      return {
        id: appointment.id,
        startTime: confirmation.startTime.toISOString(),
        endTime: confirmation.endTime.toISOString(),
        currency: tenant.currency,
        durationMinutes: chosen.reduce(
          (total, service) => total + service.durationMinutes,
          0,
        ),
        /*
         * El comprobante se arma sobre los tramos confirmados y no sobre lo que
         * pidió el cliente: el orden, la hora de cada uno y sobre todo quién los
         * atiende salen de la revalidación, que es la que tuvo la última palabra.
         */
        services: confirmation.segments.map((segment) => {
          const service = serviceById.get(segment.serviceId)!;

          return {
            serviceId: service.id,
            name: service.name,
            staffName: staffNames.get(segment.staffId) ?? null,
            price: toPrice(service.price),
            durationMinutes: service.durationMinutes,
            startTime: segment.startTime.toISOString(),
          };
        }),
      };
    } catch (error: unknown) {
      /*
       * El índice único es la última barrera: otro cliente ganó la carrera entre
       * la revalidación y la escritura. Para quien está mirando la pantalla es lo
       * mismo que un horario ocupado, y se responde igual.
       */
      if (error instanceof SlotAlreadyTakenError) {
        this.logger.warn(
          `Carrera perdida por el horario (slug=${slug}, startTime=${startTime.toISOString()}).`,
        );
        throw new ConflictException(SLOT_TAKEN_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * El negocio detrás del slug, o 404.
   *
   * Un negocio sin slug no tiene página, así que no se puede llegar acá con uno
   * vacío; el `as string` de `getProfile` se apoya en esta comprobación.
   */
  private async resolveTenant(slug: string): Promise<Tenant> {
    const tenant = await this.tenantsService.findBySlug(slug);
    if (!tenant || !tenant.slug) {
      throw new NotFoundException('Negocio no encontrado');
    }
    return tenant;
  }

  /**
   * Los nombres del equipo, por id.
   *
   * Una consulta para todo el equipo y no una por servicio: los tramos de una
   * misma reserva pueden ir con personas distintas, y preguntar "quién hace este
   * servicio" una vez por tramo serían tantas consultas como servicios para
   * llenar un comprobante que se lee una sola vez.
   */
  private async resolveStaffNames(
    tenantId: string,
  ): Promise<Map<string, string>> {
    const staff = await this.bookingAvailabilityService.getBookableStaff({
      tenantId,
    });

    return new Map(staff.map((member) => [member.id, member.name]));
  }
}

/**
 * Un solo texto para las dos formas de perder el horario —la revalidación y el
 * índice único—, porque para el cliente son el mismo hecho.
 */
const SLOT_TAKEN_MESSAGE = 'Ese horario se acaba de ocupar. Elegí otro.';

/**
 * `count` fechas consecutivas en formato `YYYY-MM-DD`, empezando por `from`.
 *
 * La aritmética va en UTC a propósito: son fechas de calendario, no instantes.
 * Sumarle un día a un `Date` local se rompe el domingo del cambio de hora, que
 * dura 23 o 25 horas.
 */
function nextDates(from: string, count: number): string[] {
  const [year, month, day] = from.split('-').map(Number);
  const start = Date.UTC(year, month - 1, day);

  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  );
}
