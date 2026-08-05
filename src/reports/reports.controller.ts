import {
  Controller,
  Get,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { ReportsService } from './reports.service';
import { ReportQueryDto } from './dto/report-query.dto';

@ApiTags('reports')
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
