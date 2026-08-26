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
import { UpdateAppointmentStatusDto } from './dto/update-appointment-status.dto';
import { AppointmentsRangeQueryDto } from './dto/appointments-range-query.dto';
import { EditBookingDto } from './dto/edit-booking.dto';
import { Actor, canAdminister, type AuthenticatedActor } from '../auth/actor';
import { AdminOnly, RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('appointments')
/*
 * El guard de roles se monta acá y los permisos se declaran método por método.
 *
 * A nivel de clase quedaría más corto, pero este controlador tiene las dos clases
 * de endpoint: los que solo administra el negocio y los que un profesional lee
 * acotados a él. Declararlo en cada uno obliga a decidir para cada endpoint nuevo,
 * en lugar de que herede el permiso de la clase sin que nadie lo piense.
 */
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @AdminOnly()
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

  @AdminOnly()
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

  /**
   * Las citas de un rango de días. Va antes de `:id` para que `range` no se lea
   * como el identificador de una cita.
   *
   * Un profesional recibe solo las citas en las que atiende. El recorte lo decide
   * **el servidor con el `staffId` del token**, y no hay parámetro que lo cambie:
   * si el filtro viniera por query —aunque el panel siempre lo mandara bien—
   * bastaría con editarlo a mano para leer la agenda de un compañero. Que la regla
   * no sea expresable desde el request es lo que la hace una regla.
   */
  @Get('range')
  findRange(
    @Actor() actor: AuthenticatedActor,
    @Query() query: AppointmentsRangeQueryDto,
  ) {
    return this.appointmentsService.findRangeByTenant(
      actor.tenantId,
      query.from,
      query.to,
      canAdminister(actor) ? undefined : (actor.staffId ?? undefined),
    );
  }

  @AdminOnly()
  @Get(':id')
  findOne(@Req() req: Request, @Param('id') id: string) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.appointmentsService.findDetailByTenant(id, tenantId);
  }

  @AdminOnly()
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateAppointmentStatusDto,
  ) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.appointmentsService.updateByTenant(
      id,
      tenantId,
      updateStatusDto,
    );
  }

  /**
   * Edita la reserva: cuándo empieza y qué servicios tiene, con su profesional.
   *
   * Es la misma cita, no una nueva: conserva id, historial y relaciones. Va en su
   * propia ruta y no en `PATCH :id` porque ese recibe parches campo por campo
   * —hoy lo usa el cambio de estado— y esto es un estado deseado completo.
   */
  @AdminOnly()
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

  @AdminOnly()
  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.appointmentsService.removeByTenant(id, tenantId);
  }
}
