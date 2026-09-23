import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { AvailabilityService } from './availability.service';
import { BookingAvailabilityService } from './booking/booking-availability.service';
import { BookingSlotsQueryDto } from './dto/booking-slots-query.dto';
import { BookingLayoutDto } from './dto/booking-layout.dto';
import { FindAvailableSlotsDto } from './dto/find-available-slots.dto';
import { WorkingStaffQueryDto } from './dto/working-staff-query.dto';

@ApiTags('availability')
@Controller('availability')
export class AvailabilityController {
  constructor(
    private readonly availabilityService: AvailabilityService,
    private readonly bookingAvailabilityService: BookingAvailabilityService,
  ) {}

  /**
   * Horarios reservables para crear una cita a mano desde Agenda.
   *
   * Delega en el mismo servicio que usa el flujo guiado de WhatsApp, sin
   * variantes: un horario no puede estar libre en una pantalla y ocupado en la
   * otra. La única diferencia la pone `scope`, y es de propósito: el panel
   * también registra lo que ya ocurrió, así que no tiene piso de hora.
   *
   * No confundir con `POST slots`, que es el motor conversacional: sugiere
   * horarios alrededor de una hora pedida, con otro paso y otras reglas.
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('booking-slots')
  getBookingSlots(@Req() req: Request, @Query() query: BookingSlotsQueryDto) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }

    return this.bookingAvailabilityService.getAvailableSlots({
      tenantId,
      date: query.date,
      // Agenda carga un servicio por vez. Varios servicios encadenados son cosa
      // de la página pública; acá el bloque y el servicio son lo mismo.
      items: [{ serviceId: query.serviceId, staffId: query.staffId }],
      excludeAppointmentId: query.excludeAppointmentId,
      scope: query.scope,
    });
  }

  /**
   * Dónde arranca cada servicio de una reserva, antes de guardarla.
   *
   * Lo consulta el drawer de Agenda para dibujar los tramos y para preguntar
   * disponibilidad con los desplazamientos correctos. La cuenta es la misma que
   * usa la creación de la cita, y por eso se pide en vez de repetirse acá: un
   * negocio que declaró que dos categorías se atienden a la vez tiene que ver en
   * la pantalla la misma reserva que se va a escribir.
   *
   * `POST` aunque no cambie nada: lo que se manda es una lista de servicios con
   * su profesional, que en una query string sería una cadena que hay que parsear
   * a mano.
   */
  @UseGuards(AuthGuard('jwt'))
  @Post('booking-layout')
  getBookingLayout(@Req() req: Request, @Body() body: BookingLayoutDto) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }

    return this.bookingAvailabilityService.resolveBookingLayout({
      tenantId,
      items: body.items,
    });
  }

  @Post('slots')
  findAvailableSlots(@Body() input: FindAvailableSlotsDto) {
    return this.availabilityService.findAvailableSlots(input);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('working-staff')
  getWorkingStaff(@Req() req: Request, @Query() query: WorkingStaffQueryDto) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.availabilityService.getWorkingStaff(tenantId, query.date);
  }
}
