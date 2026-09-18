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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

import { AdminOnly, RolesGuard } from '../auth/guards/roles.guard';
import { ServiceCategoriesService } from './service-categories.service';
import { CreateServiceCategoryDto } from './dto/create-service-category.dto';
import { UpdateServiceCategoryDto } from './dto/update-service-category.dto';
import { MoveServiceCategoryDto } from './dto/move-service-category.dto';

@ApiTags('service-categories')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@AdminOnly()
@Controller('service-categories')
export class ServiceCategoriesController {
  constructor(private readonly categoriesService: ServiceCategoriesService) {}

  @Get()
  findAll(@Req() req: Request) {
    return this.categoriesService.findByTenant(this.tenantId(req));
  }

  @Post()
  create(@Req() req: Request, @Body() dto: CreateServiceCategoryDto) {
    return this.categoriesService.create(this.tenantId(req), dto);
  }

  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateServiceCategoryDto,
  ) {
    return this.categoriesService.updateByTenant(id, this.tenantId(req), dto);
  }

  /**
   * Un lugar arriba o abajo. Devuelve la lista completa ya reordenada.
   *
   * El orden de las categorías es el del menú de WhatsApp, así que esto no es
   * una preferencia estética del panel: decide qué ve primero el cliente.
   */
  @Patch(':id/move')
  move(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: MoveServiceCategoryDto,
  ) {
    return this.categoriesService.moveByTenant(
      id,
      this.tenantId(req),
      dto.direction,
    );
  }

  /**
   * Devuelve 204 y nada. La categoría ya no está y los servicios que tenía
   * quedaron sin categoría; quien borró necesita recargar el catálogo entero,
   * no la fila que borró.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Req() req: Request, @Param('id') id: string) {
    return this.categoriesService.removeByTenant(id, this.tenantId(req));
  }

  private tenantId(req: Request): string {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return tenantId;
  }
}
