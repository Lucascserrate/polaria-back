import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CustomerAccountId, CustomerGuard } from './customer-session';
import { CustomerAppointmentsService } from './customer-appointments.service';
import { CustomerAppointmentsQueryDto } from './dto/customer-appointments-query.dto';

/**
 * Los turnos de quien reserva.
 *
 * Cuelga de `/customer/me` y no de `/public/businesses/:slug` a propósito, aunque
 * hoy lo único que lo llame sea la página de reservas de un negocio: lo que
 * devuelve son los turnos de **una persona**, y una ruta que empieza en un
 * negocio diría que son del negocio. Acá el sujeto es la cuenta, que es también
 * la razón por la que esto puede crecer hasta la pantalla de turnos de Polaria
 * sin cambiar de lugar.
 *
 * `CustomerGuard` y no la lectura opcional de sesión que usa la reserva: sin
 * sesión no hay respuesta correcta que dar. La página pública sólo pregunta esto
 * cuando ya sabe que hay sesión, así que el 401 es una red, no un camino.
 */
@ApiTags('customer')
@Controller('customer/me/appointments')
@UseGuards(CustomerGuard)
export class CustomerAppointmentsController {
  constructor(private readonly appointments: CustomerAppointmentsService) {}

  /**
   * Los turnos vigentes de la cuenta, del más próximo en adelante.
   *
   * Vigente significa lo mismo que en WhatsApp —ocupa agenda y todavía no
   * empezó—, y lo decide `AppointmentsService`: uno cancelado o ya atendido no
   * sale de acá. Ver `findUpcomingByCustomerAccount`.
   */
  @Get()
  findUpcoming(
    @CustomerAccountId() accountId: string,
    @Query() query: CustomerAppointmentsQueryDto,
  ) {
    return this.appointments.findUpcoming({
      accountId,
      businessSlug: query.business,
    });
  }
}
