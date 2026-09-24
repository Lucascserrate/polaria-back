import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  describeServices,
  describeStaff,
} from '../appointments/appointment-naming';
import { AppointmentsService } from '../appointments/appointments.service';
import { BookingAvailabilityService } from '../availability/booking/booking-availability.service';
import {
  currentDateInTimeZone,
  nextDates,
} from '../availability/utils/availability.helpers';
import { blocksAgenda } from '../appointments/entities/appointment.entity';
import { BookingClaimService } from './booking-claim';
import { BusinessPhotosService } from '../business-photos/business-photos.service';
import { TenantsService } from '../tenants/tenants.service';
import { toPrice } from '../services/quoted-price';
import type {
  Appointment,
  AppointmentStatus,
} from '../appointments/entities/appointment.entity';

/**
 * El negocio donde está el turno, recortado a lo que hace falta para mostrarlo.
 *
 * Viaja aunque se haya pedido filtrando por un negocio —donde la página ya lo
 * sabe— porque es lo único que separa a este contrato de servir también para la
 * pantalla de turnos de la cuenta, que mezcla negocios. Sin esto, esa pantalla
 * necesitaría un segundo endpoint que contesta casi lo mismo.
 */
export interface CustomerAppointmentBusiness {
  slug: string;
  name: string;
  /** La zona del negocio: es con la que hay que escribir el día y la hora. */
  timezone: string;
  /**
   * La primera foto de la galería, o `null` si el negocio no subió ninguna.
   *
   * Encabeza la tarjeta del historial, donde es lo que hace reconocible al
   * local: una lista de turnos de varios negocios se recorre por la foto antes
   * que por el nombre. La tarjeta se tiene que dibujar igual sin ella.
   */
  photoUrl: string | null;
}

/**
 * Un turno de la cuenta, tal como lo lee el sitio público.
 *
 * Se escribe campo por campo y no se devuelve la entidad, por lo mismo que
 * `PublicBusinessProfile`: una cita arrastra el cliente, el tenant y los precios
 * pactados, y nada de eso tiene por qué salir hacia una página.
 */
export interface CustomerAppointmentView {
  id: string;
  /** Instante de inicio en ISO. La zona con la que se escribe es la del negocio. */
  startTime: string;
  endTime: string;
  /**
   * En qué quedó el turno.
   *
   * Hace falta desde que la lista incluye el historial: ahí conviven el que se
   * atendió y el que se canceló, y sin esto se leerían igual.
   */
  status: AppointmentStatus;
  serviceName: string;
  /** `null` cuando la relación no trajo profesional. */
  staffName: string | null;
  business: CustomerAppointmentBusiness;
}

/**
 * Un servicio del turno, con lo que se pactó al reservarlo.
 *
 * El precio y la duración salen de las columnas `*AtBooking` y no del catálogo
 * de hoy: un historial que se actualiza solo cuando el negocio sube los precios
 * le cambia a alguien lo que pagó el mes pasado.
 */
export interface CustomerAppointmentItem {
  name: string;
  staffName: string | null;
  /** Cuándo empieza **este** servicio, que con varios no es el del turno. */
  startTime: string;
  durationMinutes: number;
  /** `null` cuando el servicio se cotiza. Ver `quoted-price`. */
  price: number | null;
}

/**
 * El turno completo: lo que se ve al abrir uno del historial.
 *
 * Extiende la vista de la lista en lugar de repetirla porque el detalle muestra
 * lo mismo y además el desglose: con dos contratos sueltos, el encabezado del
 * turno quedaría escrito dos veces y podría decir cosas distintas.
 */
export interface CustomerAppointmentDetail extends CustomerAppointmentView {
  /** En orden de atención. Nunca vacío. */
  services: CustomerAppointmentItem[];
  /**
   * Lo que dura estar ahí, del inicio del bloque a su fin.
   *
   * Sale de la cita y no de sumar los servicios: con servicios en paralelo el
   * bloque dura menos que la suma, y es el bloque lo que ocupa la tarde.
   */
  durationMinutes: number;
  /**
   * La suma de lo pactado, o `null` si algún servicio se cotiza.
   *
   * `null` y no la suma de los que sí tienen importe, igual que el resumen de la
   * reserva: un total que ignora al servicio que se cotiza es un número que el
   * cliente va a leer como lo que paga, y no lo es.
   */
  total: number | null;
  currency: string;
  address: string | null;
  location: { latitude: number; longitude: number } | null;
  /**
   * Lo que el negocio quiere que se lea junto a este turno, o `null`.
   *
   * Una seña que hay que transferir, un timbre que no anda. Viaja en el detalle
   * y no en la lista porque es un párrafo: en una tarjeta no entraría, y en la
   * pantalla del turno es donde alguien vuelve a leerlo antes de ir. Ver
   * `appointment-note.ts`.
   */
  note: string | null;
}

/**
 * Los turnos de quien reserva, vistos desde su cuenta de Polaria.
 *
 * Es una capa de traducción y no un motor: qué cuenta como turno vigente lo
 * decide `AppointmentsService`, que es el mismo que responde la pregunta cuando
 * la hace WhatsApp. Acá sólo se resuelve el negocio por su slug y se recorta la
 * respuesta a lo publicable.
 *
 * Vive en `customer-accounts` y no en `public-booking` porque lo que contesta no
 * es público: sin sesión no hay respuesta posible, y el controlador de la página
 * de reservas es el único de la API sin guard justamente porque todo lo que
 * devuelve lo puede leer cualquiera.
 */
@Injectable()
export class CustomerAppointmentsService {
  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly tenantsService: TenantsService,
    private readonly businessPhotos: BusinessPhotosService,
    private readonly bookingAvailability: BookingAvailabilityService,
    private readonly bookingClaim: BookingClaimService,
  ) {}

  /**
   * Los turnos vigentes de la cuenta, del más próximo en adelante.
   *
   * Con `businessSlug` responde "qué tengo con este negocio", que es lo que la
   * página de reservas pregunta antes de dejar sacar otro turno. Sin él
   * responde por toda Polaria, que es lo que lee el historial.
   */
  async findUpcoming(params: {
    accountId: string;
    businessSlug?: string;
  }): Promise<CustomerAppointmentView[]> {
    const tenantId = params.businessSlug
      ? await this.resolveTenantId(params.businessSlug)
      : undefined;

    const appointments =
      await this.appointmentsService.findUpcomingByCustomerAccount({
        customerAccountId: params.accountId,
        tenantId,
      });

    return this.toViews(appointments);
  }

  /**
   * Lo que la cuenta ya no tiene por delante, lo más reciente primero.
   *
   * La otra mitad del historial. Qué entra acá —lo que ya pasó y también lo
   * cancelado, aunque el día no haya llegado— lo decide `AppointmentsService`,
   * por la misma razón que lo vigente: dos definiciones del corte harían que las
   * dos listas de la misma pantalla se dejaran turnos en el medio.
   */
  async findPast(params: {
    accountId: string;
    businessSlug?: string;
  }): Promise<CustomerAppointmentView[]> {
    const tenantId = params.businessSlug
      ? await this.resolveTenantId(params.businessSlug)
      : undefined;

    const appointments =
      await this.appointmentsService.findPastByCustomerAccount({
        customerAccountId: params.accountId,
        tenantId,
      });

    return this.toViews(appointments);
  }

  /**
   * Un turno de la cuenta, con el desglose.
   *
   * El 404 sale tanto para un id que no existe como para uno que es de otra
   * cuenta, y a propósito: distinguirlos convertiría esto en una forma de
   * averiguar qué ids son reales. La pertenencia la impone la consulta y no un
   * `if` de acá. Ver `findByCustomerAccountAndId`.
   */
  async findOne(params: {
    accountId: string;
    appointmentId: string;
  }): Promise<CustomerAppointmentDetail> {
    const appointment =
      await this.appointmentsService.findByCustomerAccountAndId({
        customerAccountId: params.accountId,
        appointmentId: params.appointmentId,
      });

    if (!appointment) {
      throw new NotFoundException('Turno no encontrado');
    }

    const [view] = await this.toViews([appointment]);

    const services: CustomerAppointmentItem[] = inOrderOfCare(appointment).map(
      (segment) => ({
        name: segment.service?.name ?? 'Servicio',
        staffName: segment.staff?.name ?? null,
        startTime: segment.startTime.toISOString(),
        durationMinutes: segment.durationAtBooking,
        price: toPrice(segment.priceAtBooking),
      }),
    );

    const quoted = services.some((service) => service.price === null);

    return {
      ...view,
      services,
      durationMinutes: Math.max(
        0,
        Math.round(
          (appointment.endTime.getTime() - appointment.startTime.getTime()) /
            60_000,
        ),
      ),
      total: quoted
        ? null
        : services.reduce((sum, service) => sum + (service.price ?? 0), 0),
      currency: appointment.tenant.currency,
      address: appointment.tenant.address ?? null,
      location: toLocation(appointment.tenant),
      note: appointment.tenant.appointmentNote ?? null,
    };
  }

  /**
   * Cancela un turno de la cuenta y devuelve cómo quedó.
   *
   * Devuelve el turno y no un `ok` porque la pantalla que lo pidió lo está
   * mostrando: con el turno de vuelta se redibuja con su estado nuevo, sin una
   * segunda consulta para averiguar qué pasó.
   *
   * Los dos rechazos dicen cosas distintas a propósito. Un id que no existe —o
   * que es de otra cuenta— es un 404, igual que al abrirlo. Un turno que ya
   * empezó es un 409 con el motivo escrito: no es que no exista, es que ya no se
   * cancela, y quien está mirando la pantalla necesita saber cuál de las dos
   * cosas le pasó.
   *
   * La regla de "ya empezó" se comprueba acá para poder contestar 409, y otra
   * vez en `cancelByCustomerAccount`, que es donde vive de verdad. No es una
   * duplicación por olvido: la de acá elige el mensaje, la de allá es la que
   * impide el cambio, y tiene que seguir impidiéndolo aunque mañana la llame
   * otro camino que no pase por este servicio.
   */
  async cancel(params: {
    accountId: string;
    appointmentId: string;
  }): Promise<CustomerAppointmentDetail> {
    const appointment =
      await this.appointmentsService.findByCustomerAccountAndId({
        customerAccountId: params.accountId,
        appointmentId: params.appointmentId,
      });

    if (!appointment) {
      throw new NotFoundException('Turno no encontrado');
    }

    if (appointment.startTime < new Date()) {
      throw new ConflictException(
        'Ese turno ya empezó, así que no se puede cancelar desde acá. Escribile al negocio.',
      );
    }

    await this.appointmentsService.cancelByCustomerAccount({
      customerAccountId: params.accountId,
      appointmentId: params.appointmentId,
    });

    return this.findOne(params);
  }

  /**
   * Adopta los turnos que nombra el token de un enlace de WhatsApp.
   *
   * Es el mismo mecanismo que usa el invitado de la web, con el token del
   * enlace en lugar de la cookie del navegador: el turno lo creó WhatsApp, así
   * que nació sin cuenta y el historial lo daría por inexistente. La
   * comprobación de que siga sin dueño la hace la consulta, no este método.
   *
   * Devuelve los turnos de la cuenta que el token nombra, hayan pasado a ella
   * recién o ya fueran suyos: lo segundo es lo que pasa al abrir el mismo
   * enlace dos veces, y tiene que llevar al turno igual en lugar de a una
   * pantalla de error.
   */
  async claimFromLink(params: {
    accountId: string;
    token: string;
  }): Promise<{ appointmentIds: string[] }> {
    const candidates = this.bookingClaim.idsFromLinkToken(params.token);
    if (candidates.length === 0) return { appointmentIds: [] };

    await this.appointmentsService.linkToCustomerAccount({
      appointmentIds: candidates,
      customerAccountId: params.accountId,
    });

    /*
     * Se relee en lugar de confiar en cuántos se vincularon: lo que hace falta
     * devolver es a cuáles puede entrar esta cuenta, y eso incluye los que ya
     * eran suyos y excluye los que mientras tanto tomó otra.
     */
    const owned = await Promise.all(
      candidates.map((appointmentId) =>
        this.appointmentsService.findByCustomerAccountAndId({
          customerAccountId: params.accountId,
          appointmentId,
        }),
      ),
    );

    return {
      appointmentIds: owned
        .filter((appointment) => appointment !== null)
        .map((appointment) => appointment.id),
    };
  }

  /**
   * Qué días se le pueden ofrecer a un turno que se está moviendo.
   *
   * Es el filtro grueso del calendario —qué días abre el negocio y tiene gente
   * que pueda con esos servicios—, el mismo que usa la página de reservas. No
   * mira ocupación, así que la cita que se está moviendo no lo altera.
   */
  async reschedulableDays(params: {
    accountId: string;
    appointmentId: string;
    days?: number;
  }): Promise<string[]> {
    const appointment = await this.movable(params);
    const timezone = appointment.tenant.timezone;

    return this.bookingAvailability.getServiceableDates({
      tenantId: appointment.tenantId,
      dates: nextDates(
        currentDateInTimeZone(timezone, new Date()),
        params.days ?? DEFAULT_RESCHEDULE_DAYS,
      ),
      items: itemsOf(appointment),
    });
  }

  /**
   * Los horarios de un día para mover el turno.
   *
   * **La cita que se mueve no cuenta como ocupada**: sin eso, el horario que ya
   * tiene sería el único que no se le ofrece, y "cambiar de las 9:00 a las 9:00
   * del martes" dejaría de existir por bloquearse a sí misma. Eso es
   * `excludeAppointmentId`, y no viaja desde el navegador: sale del id de la URL,
   * que es el mismo que ya demostró ser de esta cuenta.
   *
   * Los servicios y el profesional también salen del turno. **Se conserva quien
   * atiende**, y es una decisión: mover la hora no es cambiar de manos, y
   * ofrecer en silencio horarios de otra persona sorprendería a quien reservó
   * con alguien. Quien quiera cambiar de profesional cancela y reserva de nuevo.
   */
  async reschedulableSlots(params: {
    accountId: string;
    appointmentId: string;
    date: string;
  }): Promise<Array<{ startTime: string; endTime: string }>> {
    const appointment = await this.movable(params);

    const slots = await this.bookingAvailability.getAvailableSlots({
      tenantId: appointment.tenantId,
      date: params.date,
      items: itemsOf(appointment),
      excludeAppointmentId: appointment.id,
      scope: 'client',
    });

    return slots.map((slot) => ({
      startTime: slot.startTime.toISOString(),
      endTime: slot.endTime.toISOString(),
    }));
  }

  /**
   * Mueve el turno a otro horario y devuelve cómo quedó.
   *
   * **Es la misma cita, no una nueva**: conserva el id, el historial y el enlace
   * que el cliente pueda tener guardado. Pasa por `editBookingByTenant`, que es
   * el mismo mecanismo del drawer del panel y el que ya usa WhatsApp, así que
   * "cambiar un turno" tiene una sola implementación: valida, replanifica los
   * tramos y los reescribe en una transacción.
   *
   * Acá no se decide ninguna regla de agenda: se traduce lo que eligió el
   * cliente al estado deseado que ese método espera. La pertenencia ya la
   * comprobó `movable`, porque `editBookingByTenant` es la edición del negocio y
   * no filtra por cuenta.
   */
  async reschedule(params: {
    accountId: string;
    appointmentId: string;
    startTime: string;
  }): Promise<CustomerAppointmentDetail> {
    const appointment = await this.movable(params);

    await this.appointmentsService.editBookingByTenant(
      appointment.id,
      appointment.tenantId,
      {
        startTime: new Date(params.startTime).toISOString(),
        items: inOrderOfCare(appointment).map((segment) => ({
          serviceId: segment.serviceId,
          staffId: segment.staffId,
        })),
      },
    );

    return this.findOne(params);
  }

  /**
   * El turno de esta cuenta que todavía se puede mover, o el error que explica
   * por qué no.
   *
   * Los tres caminos de reagendar —los días, los horarios y el cambio— arrancan
   * con la misma pregunta, y tiene que contestarse igual en los tres: ofrecer
   * horarios para un turno que ya empezó y recién rechazarlo al confirmar sería
   * dejar que alguien elija algo que nunca se iba a poder aplicar.
   */
  private async movable(params: {
    accountId: string;
    appointmentId: string;
  }): Promise<Appointment> {
    const appointment =
      await this.appointmentsService.findByCustomerAccountAndId({
        customerAccountId: params.accountId,
        appointmentId: params.appointmentId,
      });

    if (!appointment) {
      throw new NotFoundException('Turno no encontrado');
    }

    if (!blocksAgenda(appointment.status)) {
      throw new ConflictException(
        'Ese turno ya no está activo, así que no se puede mover.',
      );
    }

    if (appointment.startTime < new Date()) {
      throw new ConflictException(
        'Ese turno ya empezó, así que no se puede mover desde acá. Escribile al negocio.',
      );
    }

    return appointment;
  }

  /**
   * Las vistas de una lista de turnos, con la foto de cada negocio.
   *
   * Las fotos se piden todas juntas y no turno por turno: el historial de quien
   * vuelve siempre al mismo lugar son diez turnos del mismo negocio, y pedirla
   * de a una serían diez consultas para una sola imagen.
   */
  private async toViews(
    appointments: Appointment[],
  ): Promise<CustomerAppointmentView[]> {
    if (appointments.length === 0) return [];

    const covers = await this.businessPhotos.covers([
      ...new Set(appointments.map((appointment) => appointment.tenantId)),
    ]);

    return appointments.map((appointment) => {
      const segments = inOrderOfCare(appointment);

      return {
        id: appointment.id,
        startTime: appointment.startTime.toISOString(),
        endTime: appointment.endTime.toISOString(),
        status: appointment.status,
        serviceName: describeServices(segments),
        staffName: describeStaff(segments),
        business: {
          slug: appointment.tenant.slug ?? '',
          name: appointment.tenant.name,
          timezone: appointment.tenant.timezone,
          photoUrl: covers.get(appointment.tenantId)?.url ?? null,
        },
      };
    });
  }

  /**
   * El negocio detrás del slug, o 404.
   *
   * El mismo trato que le da la página pública: la URL la escribe gente a mano,
   * y devolver una lista vacía para un negocio que no existe diría "no tenés
   * turnos ahí" en lugar de "ese negocio no existe".
   */
  private async resolveTenantId(slug: string): Promise<string> {
    const tenant = await this.tenantsService.findBySlug(slug);
    if (!tenant || !tenant.slug) {
      throw new NotFoundException('Negocio no encontrado');
    }
    return tenant.id;
  }
}

/** Un mes de calendario: lo mismo que ofrece la página de reservas. */
const DEFAULT_RESCHEDULE_DAYS = 30;

/**
 * El turno leído como lo que el motor de disponibilidad espera.
 *
 * Servicio y profesional de cada tramo, en orden: es lo que hace que mover el
 * turno busque hueco para **lo mismo** que ya estaba reservado.
 */
const itemsOf = (appointment: Appointment) =>
  inOrderOfCare(appointment).map((segment) => ({
    serviceId: segment.serviceId,
    staffId: segment.staffId,
  }));

/**
 * Los tramos del turno en orden de atención.
 *
 * La relación viene sin orden desde la base, así que el que llega es el que
 * quiso MySQL. Sin esto, el título y el desglose de la misma pantalla ordenaban
 * distinto: arriba decía "Corte y Barba" y abajo listaba la barba a las 13:00 y
 * el corte a las 13:30. Los dos salen de acá justamente para que no puedan
 * discrepar.
 */
const inOrderOfCare = (appointment: Appointment) =>
  [...(appointment.services ?? [])].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime(),
  );

/**
 * El punto en el mapa, o `null`.
 *
 * Las dos coordenadas o ninguna: media coordenada no ubica nada y dibujaría un
 * marcador en el ecuador.
 */
const toLocation = (tenant: {
  latitude?: number | null;
  longitude?: number | null;
}): { latitude: number; longitude: number } | null =>
  tenant.latitude != null && tenant.longitude != null
    ? { latitude: Number(tenant.latitude), longitude: Number(tenant.longitude) }
    : null;
