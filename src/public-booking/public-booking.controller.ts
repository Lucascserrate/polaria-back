import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { BookingClaimService } from '../customer-accounts/booking-claim';
import { CustomerSessionService } from '../customer-accounts/customer-session';

import { CreatePublicBookingDto } from './dto/create-public-booking.dto';
import { PublicDaysQueryDto } from './dto/public-days-query.dto';
import { PublicStaffQueryDto } from './dto/public-staff-query.dto';
import { PublicSlotsQueryDto } from './dto/public-slots-query.dto';
import { PublicBookingService } from './public-booking.service';

/**
 * La página de reservas de un negocio, para cualquiera que tenga el enlace.
 *
 * **Es el único controlador sin guard de toda la API, y eso es deliberado**:
 * todo lo que responde —qué ofrece el negocio, cuándo atiende— tiene que poder
 * leerlo cualquiera que llegue desde un QR o desde Instagram, sin sesión. La
 * reserva sí mira si hay sesión de cliente, pero la **lee**, no la exige: es lo
 * que permite que el sitio ya desplegado siga reservando con nombre y teléfono
 * mientras sale la versión que pide cuenta.
 *
 * Lo que lo hace seguro no es un permiso sino la forma de las rutas: todo cuelga de `:slug`, el negocio nunca viaja como id, y
 * la respuesta se arma campo por campo en `PublicBookingService` —nunca
 * devolviendo una entidad— así que agregar una columna sensible al tenant no
 * puede filtrarla acá.
 *
 * Un endpoint nuevo en este controlador es una decisión de publicar algo. Los
 * que ya están responden tres preguntas y ninguna más: qué ofrece el negocio,
 * cuándo puede atenderme y quiero este turno.
 */
@ApiTags('public-booking')
@Controller('public/businesses/:slug')
export class PublicBookingController {
  constructor(
    private readonly publicBookingService: PublicBookingService,
    private readonly customerSession: CustomerSessionService,
    private readonly bookingClaim: BookingClaimService,
  ) {}

  @Get()
  getProfile(@Param('slug') slug: string) {
    return this.publicBookingService.getProfile(slug);
  }

  /**
   * Quién puede atender lo elegido.
   *
   * Recibe los servicios y no uno solo porque una reserva puede llevar varios:
   * la respuesta trae la lista de quienes pueden con todo y, aparte, la de cada
   * servicio. Ver `PublicBookingStaff`.
   */
  @Get('staff')
  getStaff(@Param('slug') slug: string, @Query() query: PublicStaffQueryDto) {
    return this.publicBookingService.getStaff(slug, query.serviceIds);
  }

  @Get('slots')
  getSlots(@Param('slug') slug: string, @Query() query: PublicSlotsQueryDto) {
    return this.publicBookingService.getSlots(slug, query);
  }

  /** Qué días de acá en adelante atiende el negocio. Ver `getServiceableDays`. */
  @Get('days')
  getDays(@Param('slug') slug: string, @Query() query: PublicDaysQueryDto) {
    return this.publicBookingService.getServiceableDays(slug, query);
  }

  /**
   * La sesión de cliente se lee, no se exige.
   *
   * Con sesión, el nombre y el teléfono salen de la cuenta. Sin sesión sigue
   * andando el camino de siempre —nombre y teléfono en el cuerpo—, y eso es a
   * propósito: el sitio desplegado hoy manda así, y esta API tiene que poder
   * atender a las dos versiones mientras el despliegue nuevo sale.
   */
  @Post('bookings')
  async createBooking(
    @Param('slug') slug: string,
    @Body() dto: CreatePublicBookingDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const accountId = this.customerSession.read(req);
    const confirmation = await this.publicBookingService.createBooking(
      slug,
      dto,
      accountId,
    );

    /*
     * Sin cuenta, el turno nace sin dueño y no aparecería en el historial de
     * nadie. La cookie guarda que lo creó **este** navegador, que es lo que
     * permite pasárselo a la cuenta si la persona inicia sesión a continuación.
     * Con sesión no hace falta: ya quedó vinculado al escribirlo.
     */
    if (!accountId) {
      this.bookingClaim.remember(req, res, confirmation.id);
    }

    return confirmation;
  }
}
