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
import { ServicesService } from '../services/services.service';
import {
  CONSULTATION_FIRST_NOTICE,
  isSelfBookable,
} from '../services/booking-policy';
import { dialCodeForTimeZone } from '../tenants/dial-code';
import { TenantsService } from '../tenants/tenants.service';
import type { Tenant } from '../tenants/entities/tenant.entity';
import type {
  PublicBookingConfirmation,
  PublicBusinessProfile,
  PublicSlot,
  PublicStaff,
} from './public-booking.types';

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
    private readonly businessHoursService: BusinessHoursService,
    private readonly bookingAvailabilityService: BookingAvailabilityService,
    private readonly clientsService: ClientsService,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  async getProfile(slug: string): Promise<PublicBusinessProfile> {
    const tenant = await this.resolveTenant(slug);

    const [services, businessHours] = await Promise.all([
      this.servicesService.findActiveByTenant(tenant.id),
      this.businessHoursService.getTenantSchedule(tenant.id),
    ]);

    return {
      slug: tenant.slug as string,
      name: tenant.name,
      businessType: tenant.businessType ?? null,
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
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description ?? null,
        // MySQL devuelve `decimal` como cadena; la página recibe un número.
        price: Number(service.price),
        durationMinutes: service.durationMinutes,
        selfBookable: isSelfBookable(service.bookingPolicy),
      })),
    };
  }

  /**
   * Profesionales habilitados para un servicio.
   *
   * Alimenta el paso de "elegir profesional", que la página se saltea cuando
   * devuelve uno solo: preguntar entre una única opción no es una elección.
   */
  async getStaff(slug: string, serviceId: string): Promise<PublicStaff[]> {
    const tenant = await this.resolveTenant(slug);

    const staff = await this.bookingAvailabilityService.getStaffForService({
      tenantId: tenant.id,
      serviceId,
    });

    return staff.map((member) => ({
      id: member.id,
      name: member.name,
      jobTitle: member.jobTitle ?? null,
    }));
  }

  async getSlots(
    slug: string,
    query: { date: string; serviceId: string; staffId?: string },
  ): Promise<PublicSlot[]> {
    const tenant = await this.resolveTenant(slug);

    const slots = await this.bookingAvailabilityService.getAvailableSlots({
      tenantId: tenant.id,
      date: query.date,
      serviceId: query.serviceId,
      staffId: query.staffId,
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
    query: { serviceId: string; staffId?: string; days?: number },
  ): Promise<string[]> {
    const tenant = await this.resolveTenant(slug);

    const today = currentDateInTimeZone(tenant.timezone, new Date());
    const dates = nextDates(today, query.days ?? 30);

    return this.bookingAvailabilityService.getServiceableDates({
      tenantId: tenant.id,
      dates,
      serviceId: query.serviceId,
      staffId: query.staffId,
    });
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
      serviceId: string;
      staffId?: string;
      startTime: string;
      customerName: string;
      customerPhone: string;
    },
  ): Promise<PublicBookingConfirmation> {
    const tenant = await this.resolveTenant(slug);

    const startTime = new Date(input.startTime);
    if (Number.isNaN(startTime.getTime())) {
      throw new BadRequestException('startTime inválido');
    }

    const service = await this.servicesService.findOneByTenant(
      input.serviceId,
      tenant.id,
    );
    if (!service || !service.isActive) {
      throw new NotFoundException('El servicio ya no está disponible');
    }

    /*
     * El rechazo es explícito y no un "no hay horarios".
     *
     * `loadContext` ya corta este caso, pero devolvería que el horario no está
     * disponible, y eso manda al cliente a probar otro día por algo que ningún día
     * va a resolver. Acá sabemos el motivo, así que se dice.
     */
    if (!isSelfBookable(service.bookingPolicy)) {
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
      serviceId: input.serviceId,
      staffId: input.staffId,
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
    const client = await this.clientsService.resolveByPhone({
      tenantId: tenant.id,
      phone: {
        kind: 'typed',
        value: input.customerPhone,
        dialCode: dialCodeForTimeZone(tenant.timezone),
      },
      name: input.customerName.trim(),
      source: ClientSource.WEB,
    });

    try {
      const appointment = await this.appointmentsService.createFromBookingFlow({
        tenantId: tenant.id,
        clientId: client.id,
        serviceId: input.serviceId,
        staffId: confirmation.staffId,
        startTime: confirmation.startTime,
        endTime: confirmation.endTime,
      });

      return {
        id: appointment.id,
        startTime: confirmation.startTime.toISOString(),
        endTime: confirmation.endTime.toISOString(),
        serviceName: service.name,
        staffName: await this.resolveStaffName(
          tenant.id,
          input.serviceId,
          confirmation.staffId,
        ),
        price: Number(service.price),
        durationMinutes: service.durationMinutes,
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

  private async resolveStaffName(
    tenantId: string,
    serviceId: string,
    staffId: string,
  ): Promise<string | null> {
    const staff = await this.bookingAvailabilityService.getStaffForService({
      tenantId,
      serviceId,
    });
    return staff.find((member) => member.id === staffId)?.name ?? null;
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
