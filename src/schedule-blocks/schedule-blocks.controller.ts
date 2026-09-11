import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ScheduleBlocksService } from './schedule-blocks.service';
import { CreateScheduleBlockDto } from './dto/create-schedule-block.dto';
import { ScheduleBlocksRangeQueryDto } from './dto/schedule-blocks-range-query.dto';
import { Actor, canAdminister, type AuthenticatedActor } from '../auth/actor';
import { AdminOnly, RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('schedule-blocks')
/*
 * El guard se monta acá y el permiso se declara método por método, igual que en
 * el controlador de citas: este también tiene las dos clases de endpoint —los
 * que administran el negocio y el que un profesional lee acotado a él—, y
 * declararlo en cada uno obliga a decidir para cada endpoint nuevo en lugar de
 * heredar el permiso sin que nadie lo piense.
 */
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('schedule-blocks')
export class ScheduleBlocksController {
  constructor(private readonly scheduleBlocksService: ScheduleBlocksService) {}

  /**
   * Los bloqueos de un rango de días. Va antes de cualquier `:id` para que
   * `range` no se lea como el identificador de un bloqueo.
   *
   * Un profesional recibe los suyos y los del negocio entero, que son los dos
   * que le tapan horas. El recorte lo decide **el servidor con el `staffId` del
   * token** y no hay parámetro que lo cambie, por el mismo motivo que en la
   * agenda: una regla que se puede reescribir desde el request no es una regla.
   */
  @Get('range')
  findRange(
    @Actor() actor: AuthenticatedActor,
    @Query() query: ScheduleBlocksRangeQueryDto,
  ) {
    return this.scheduleBlocksService.findRange(
      actor.tenantId,
      query.from,
      query.to,
      canAdminister(actor) ? undefined : (actor.staffId ?? undefined),
    );
  }

  /**
   * Marcar una franja como no disponible.
   *
   * `@AdminOnly` porque un bloqueo cierra horas de la agenda —las propias o las
   * de todo el local— y eso es administrar el negocio. Que un profesional pueda
   * taparse horas solo es otra decisión, y necesita además que el dueño lo vea.
   */
  @AdminOnly()
  @Post()
  create(
    @Actor() actor: AuthenticatedActor,
    @Body() dto: CreateScheduleBlockDto,
  ) {
    return this.scheduleBlocksService.create(actor.tenantId, dto);
  }

  @AdminOnly()
  @Delete(':id')
  remove(@Actor() actor: AuthenticatedActor, @Param('id') id: string) {
    return this.scheduleBlocksService.remove(actor.tenantId, id);
  }
}
