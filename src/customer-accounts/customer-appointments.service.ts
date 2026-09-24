import { Injectable, NotFoundException } from '@nestjs/common';

import {
  describeServices,
  describeStaff,
} from '../appointments/appointment-naming';
import { AppointmentsService } from '../appointments/appointments.service';
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
