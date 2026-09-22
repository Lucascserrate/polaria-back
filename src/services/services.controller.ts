import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminOnly, RolesGuard } from '../auth/guards/roles.guard';
import type { Request } from 'express';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ListServicesQueryDto } from './dto/list-services-query.dto';

@ApiTags('services')
@UseGuards(AuthGuard('jwt'))
@UseGuards(AuthGuard('jwt'), RolesGuard)
@AdminOnly()
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  create(@Req() req: Request, @Body() createServiceDto: CreateServiceDto) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    createServiceDto.tenantId = tenantId;
    return this.servicesService.create(createServiceDto);
  }

  /**
   * El catálogo del negocio.
   *
   * Solo los activos salvo que se pidan todos con `?scope=all`. La baja deja la
   * fila —las citas que lo usaron conservan su precio y su duración— así que
   * devolver los desactivados por defecto haría que un servicio dado de baja
   * siguiera en la lista igual que antes, y que se lo pudiera elegir en una cita
   * nueva que después el guardado rechaza.
   *
   * `all` es para el catálogo del panel, que es el único lugar donde un servicio
   * desactivado tiene sentido: es desde donde se lo vuelve a activar. Ver
   * `ListServicesQueryDto`.
   *
   * Incluye los que el cliente no puede reservar solo: esta lista contesta "qué
   * ofrece el negocio", y esa política se muestra en cada fila.
   */
  @Get()
  findAll(@Req() req: Request, @Query() query: ListServicesQueryDto) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.servicesService.findByTenant(tenantId, query.scope);
  }

  @Get(':id')
  findOne(@Req() req: Request, @Param('id') id: string) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.servicesService.findOneByTenant(id, tenantId);
  }

  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() updateServiceDto: UpdateServiceDto,
  ) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.servicesService.updateByTenant(id, tenantId, updateServiceDto);
  }
}
