import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

import { AdminOnly, RolesGuard } from '../auth/guards/roles.guard';
import { SchedulingRulesService } from './scheduling-rules.service';
import { SetParallelCategoriesDto } from './dto/set-parallel-categories.dto';

/**
 * Qué categorías se pueden atender al mismo tiempo.
 *
 * Cuelga de `service-categories` y no de una ruta propia porque es donde la
 * pantalla lo pide: el negocio abre "Manicures" y marca con qué convive. Que la
 * regla viva en su propia tabla es una decisión del modelo —ver la entidad—, no
 * algo que el panel tenga que saber.
 */
@ApiTags('service-categories')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@AdminOnly()
@Controller('service-categories')
export class SchedulingRulesController {
  constructor(private readonly schedulingRules: SchedulingRulesService) {}

  /**
   * Todas las reglas del negocio de una vez.
   *
   * La pantalla de categorías las necesita juntas para poder mostrar en cada
   * fila con qué convive sin pedir una consulta por categoría.
   */
  @Get('scheduling-rules')
  findAll(@Req() req: Request) {
    return this.schedulingRules.findByTenant(this.tenantId(req));
  }

  /**
   * Con qué categorías convive ésta. Devuelve sólo los ids.
   *
   * Las candidatas no viajan acá: son todas las demás del negocio, y esa lista
   * la pantalla ya la tiene para dibujar el catálogo. Mandarla otra vez sería
   * dos copias del mismo dato que pueden llegar distintas.
   */
  @Get(':id/parallel-with')
  findParallel(@Req() req: Request, @Param('id') id: string) {
    return this.schedulingRules.findParallelCategoryIds(this.tenantId(req), id);
  }

  /**
   * Reemplaza la lista completa de categorías que conviven con ésta.
   *
   * `PUT` y no `PATCH` porque lo que llega es el estado entero de una pantalla
   * de casillas, no un cambio: mandar sólo lo que se marcó dejaría sin forma de
   * expresar "desmarqué todas".
   *
   * La relación es simétrica, así que esto también cambia lo que se ve desde la
   * otra categoría. Es lo correcto —que las uñas convivan con los pies es la
   * misma afirmación que al revés— y la pantalla tiene que decirlo, porque si no
   * parece que se editó una sola.
   */
  @Put(':id/parallel-with')
  setParallel(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: SetParallelCategoriesDto,
  ) {
    return this.schedulingRules.setParallelCategories(
      this.tenantId(req),
      id,
      dto.categoryIds,
    );
  }

  private tenantId(req: Request): string {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return tenantId;
  }
}
