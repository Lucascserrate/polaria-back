import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  UnauthorizedException,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AppointmentsRangeQueryDto } from './dto/appointments-range-query.dto';
import { EditBookingDto } from './dto/edit-booking.dto';

@ApiTags('appointments')
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post()
  create(
    @Req() req: Request,
    @Body() createAppointmentDto: CreateAppointmentDto,
  ) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    createAppointmentDto.tenantId = tenantId;
    return this.appointmentsService.create(createAppointmentDto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get()
  findAll(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('sortBy') sortBy?: string,
  ) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    const pageNumber = page ? Number(page) : 1;
    const limitNumber = limit ? Number(limit) : 20;
    return this.appointmentsService.findAllByTenant(
      tenantId,
      pageNumber,
      limitNumber,
      {
        search: search?.trim() || undefined,
        status: status?.trim() || undefined,
        sortBy: sortBy?.trim() as 'date-asc' | 'date-desc' | undefined,
      },
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('day')
  findDay(@Req() req: Request, @Query('date') date?: string) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.appointmentsService.findDayByTenant(tenantId, date?.trim());
  }

  /**
   * Las citas de un rango de días. Va antes de `:id` para que `range` no se lea
   * como el identificador de una cita.
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('range')
  findRange(@Req() req: Request, @Query() query: AppointmentsRangeQueryDto) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.appointmentsService.findRangeByTenant(
      tenantId,
      query.from,
      query.to,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  findOne(@Req() req: Request, @Param('id') id: string) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.appointmentsService.findDetailByTenant(id, tenantId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() updateAppointmentDto: UpdateAppointmentDto,
  ) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.appointmentsService.updateByTenant(
      id,
      tenantId,
      updateAppointmentDto,
    );
  }

  /**
   * Edita la reserva: cuándo empieza y qué servicios tiene, con su profesional.
   *
   * Es la misma cita, no una nueva: conserva id, historial y relaciones. Va en su
   * propia ruta y no en `PATCH :id` porque ese recibe parches campo por campo
   * —hoy lo usa el cambio de estado— y esto es un estado deseado completo.
   */
  @UseGuards(AuthGuard('jwt'))
  @Patch(':id/booking')
  editBooking(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() editBookingDto: EditBookingDto,
  ) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.appointmentsService.editBookingByTenant(
      id,
      tenantId,
      editBookingDto,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.appointmentsService.removeByTenant(id, tenantId);
  }
}
