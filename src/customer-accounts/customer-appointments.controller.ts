import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CustomerAccountId, CustomerGuard } from './customer-session';
import { CustomerAppointmentsService } from './customer-appointments.service';
import { CustomerAppointmentsQueryDto } from './dto/customer-appointments-query.dto';

/**
 * Los turnos de quien reserva.
 *
 * Cuelga de `/customer/me` y no de `/public/businesses/:slug` a propósito: lo
 * que devuelve son los turnos de **una persona**, y una ruta que empieza en un
 * negocio diría que son del negocio. Acá el sujeto es la cuenta, que es también
 * la razón por la que esto sostiene el historial de Polaria —turnos de varios
 * negocios en una lista— sin cambiar de lugar.
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

  /**
   * Lo que ya no está vigente, lo más reciente primero.
   *
   * Una ruta propia y no un parámetro de la de arriba: las dos listas del
   * historial se piden por separado —se dibujan en secciones distintas y la de
   * abajo va a paginar antes que la de arriba—, y una sola respuesta con las dos
   * adentro obligaría a traer todo el pasado para mostrar lo próximo.
   *
   * Va **antes** de `:id` a propósito: Nest resuelve por orden de declaración y
   * al revés `past` entraría como si fuera el id de un turno.
   */
  @Get('past')
  findPast(
    @CustomerAccountId() accountId: string,
    @Query() query: CustomerAppointmentsQueryDto,
  ) {
    return this.appointments.findPast({
      accountId,
      businessSlug: query.business,
    });
  }

  /**
   * Un turno de la cuenta, con el desglose: lo que abre la pantalla de detalle.
   *
   * El id llega por la URL y la valida `ParseUUIDPipe`, que es lo que hace que
   * un id con forma de otra cosa muera acá y no en una consulta. Que el turno
   * sea de esta cuenta lo decide el servicio, no este método. Ver `findOne`.
   */
  @Get(':id')
  findOne(
    @CustomerAccountId() accountId: string,
    @Param('id', ParseUUIDPipe) appointmentId: string,
  ) {
    return this.appointments.findOne({ accountId, appointmentId });
  }

  /**
   * Cancela el turno y devuelve cómo quedó.
   *
   * `POST` y no `DELETE`: el turno no se borra. Queda en el historial con el
   * estado en cancelado, que es lo que deja que el cliente vea que efectivamente
   * lo canceló, y lo que el negocio necesita para saber que ese horario se
   * liberó en lugar de no haber existido nunca.
   *
   * Sin cuerpo: qué se cancela lo dice la URL y quién lo pide lo dice la sesión.
   * El 200 con el turno de vuelta es lo que la pantalla redibuja.
   */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CustomerAccountId() accountId: string,
    @Param('id', ParseUUIDPipe) appointmentId: string,
  ) {
    return this.appointments.cancel({ accountId, appointmentId });
  }
}
