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
   * otra. Devuelve siempre de ahora en adelante, igual que para el cliente.
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
      serviceId: query.serviceId,
      staffId: query.staffId,
      excludeAppointmentId: query.excludeAppointmentId,
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
