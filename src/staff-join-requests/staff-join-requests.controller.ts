import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';

import { Actor, type AuthenticatedActor } from '../auth/actor';
import { AdminOnly, RolesGuard } from '../auth/guards/roles.guard';
import { StaffJoinRequestsService } from './staff-join-requests.service';

/**
 * El lado de quien resuelve: los pedidos que le llegaron al negocio.
 *
 * `@AdminOnly` porque aprobar es dar acceso al panel. Un profesional no decide
 * quién más entra.
 *
 * ## Por qué no cuelga de `staff/`
 *
 * Empezó en `staff/join-requests` y no funcionaba: `StaffController` declara
 * `@Get(':id')`, se registra antes que este módulo, y Express toma la primera
 * ruta que coincide. Así que `GET /staff/join-requests` lo atendía `staff/:id`
 * con `id = 'join-requests'`, devolvía 404, y la pantalla mostraba cero pedidos
 * para siempre —sin error visible, que es lo peor de todo—.
 *
 * Se podría haber arreglado registrando este módulo antes, y sería igual de
 * frágil: el día que alguien reordene `app.module` vuelve a romperse en
 * silencio. Un recurso propio en la raíz no puede ser tapado por nadie. Los
 * pedidos además no son un subrecurso de una persona del equipo: son gente que
 * **todavía no** está en él.
 */
@ApiTags('staff')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@AdminOnly()
@Controller('join-requests')
export class StaffJoinRequestsController {
  constructor(private readonly requests: StaffJoinRequestsService) {}

  @Get()
  pending(@Actor() actor: AuthenticatedActor) {
    return this.requests.pendingForTenant(actor.tenantId);
  }

  @Post(':id/approve')
  approve(@Actor() actor: AuthenticatedActor, @Param('id') id: string) {
    return this.requests.approve(actor.tenantId, id);
  }

  @Post(':id/reject')
  reject(@Actor() actor: AuthenticatedActor, @Param('id') id: string) {
    return this.requests.reject(actor.tenantId, id);
  }
}
