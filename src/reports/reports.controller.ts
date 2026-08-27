import {
  Controller,
  Get,
  NotFoundException,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminOnly, Roles, RolesGuard } from '../auth/guards/roles.guard';
import { Actor, type AuthenticatedActor } from '../auth/actor';
import { STAFF_ACCESS_ROLES } from '../staff/staff-role';
import type { Request } from 'express';
import { ReportsService } from './reports.service';
import { ReportQueryDto } from './dto/report-query.dto';

@ApiTags('reports')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@AdminOnly()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * Un único endpoint con todo el reporte del período.
   *
   * Resumen y rankings comparten filtro y se piden siempre juntos desde el
   * dashboard: separarlos en tres rutas obligaría al cliente a repetir el rango
   * y a arriesgar que las tres respuestas correspondan a períodos distintos.
   */
  /**
   * Los números de quien pregunta, y de nadie más.
   *
   * El `staffId` sale del token y no hay parámetro que lo cambie. Es la misma
   * decisión que en `/appointments/range` y por el mismo motivo: si el profesional
   * viajara por query, editarlo a mano sería suficiente para leer la facturación de
   * un compañero.
   *
   * Va antes de `/` en el archivo por prolijidad, aunque acá no compitan: `me` es
   * un segmento y la otra ruta no tiene ninguno.
   */
  @Get('me')
  @Roles(...STAFF_ACCESS_ROLES)
  getMyReport(
    @Actor() actor: AuthenticatedActor,
    @Query() query: ReportQueryDto,
  ) {
    if (!actor.staffId) {
      /*
       * El dueño no es una fila de `staff`, así que no tiene "sus" números: los del
       * negocio son los suyos. Se responde 404 y no un reporte vacío, que se leería
       * como "no facturaste nada".
       */
      throw new NotFoundException(
        'La cuenta del negocio no tiene un reporte propio. Mirá las analíticas del negocio.',
      );
    }

    return this.reportsService.getStaffReport(
      actor.tenantId,
      actor.staffId,
      query,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get()
  getReport(@Req() req: Request, @Query() query: ReportQueryDto) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.reportsService.getReport(tenantId, query);
  }
}
