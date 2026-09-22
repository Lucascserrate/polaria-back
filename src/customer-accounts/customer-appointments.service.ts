import { Injectable, NotFoundException } from '@nestjs/common';

import { AppointmentsService } from '../appointments/appointments.service';
import { TenantsService } from '../tenants/tenants.service';
import type { Appointment } from '../appointments/entities/appointment.entity';

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
}

/**
 * Un turno vigente de la cuenta, tal como lo lee el sitio público.
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
  serviceName: string;
  /** `null` cuando la relación no trajo profesional. */
  staffName: string | null;
  business: CustomerAppointmentBusiness;
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
  ) {}

  /**
   * Los turnos vigentes de la cuenta, del más próximo en adelante.
   *
   * Con `businessSlug` responde "qué tengo con este negocio", que es lo que la
   * página de reservas pregunta antes de dejar sacar otro turno. Sin él
   * responde por toda Polaria, que es lo que va a leer la pantalla de turnos de
   * la cuenta.
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

    return appointments.map(toView);
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
 * Un turno reducido a lo que se muestra.
 *
 * Un servicio por reserva, así que se toma el primer tramo, igual que hace
 * WhatsApp al armar el menú de quien ya tiene turno.
 */
const toView = (appointment: Appointment): CustomerAppointmentView => {
  const segment = appointment.services?.[0];

  return {
    id: appointment.id,
    startTime: appointment.startTime.toISOString(),
    endTime: appointment.endTime.toISOString(),
    serviceName: segment?.service?.name ?? 'Turno',
    staffName: segment?.staff?.name ?? null,
    business: {
      slug: appointment.tenant.slug ?? '',
      name: appointment.tenant.name,
      timezone: appointment.tenant.timezone,
    },
  };
};
