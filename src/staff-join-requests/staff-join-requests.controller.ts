import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';

import { Actor, type AuthenticatedActor } from '../auth/actor';
import { AdminOnly, RolesGuard } from '../auth/guards/roles.guard';
import { Signup, SignupGuard } from '../auth/signup/signup.guard';
import type { SignupPayload } from '../auth/utils/jwt-token.util';
import {
  CreateJoinRequestDto,
  JoinSearchQueryDto,
} from './dto/join-request.dto';
import { StaffJoinRequestsService } from './staff-join-requests.service';

/**
 * El lado de quien pide: buscar su trabajo y pedir entrar.
 *
 * Detrás de `SignupGuard`, igual que el resto del alta: quien tiene sesión no
 * pasa por acá, porque ya está adentro de algún negocio.
 */
@ApiTags('auth')
@UseGuards(SignupGuard)
@Controller('signup')
export class SignupJoinController {
  constructor(private readonly requests: StaffJoinRequestsService) {}

  @Get('businesses')
  search(@Query() query: JoinSearchQueryDto) {
    return this.requests.search(query.q);
  }

  @Post('join-requests')
  create(@Signup() signup: SignupPayload, @Body() dto: CreateJoinRequestDto) {
    return this.requests.request({
      tenantId: dto.tenantId,
      googleId: signup.googleId,
      email: signup.email,
      name: signup.name,
    });
  }

  /** Lo que ya pidió esta cuenta, para la pantalla de espera. */
  @Get('join-requests')
  mine(@Signup() signup: SignupPayload) {
    return this.requests.pendingForAccount(signup.googleId);
  }
}

/**
 * El lado de quien resuelve: los pedidos que le llegaron al negocio.
 *
 * `@AdminOnly` porque aprobar es dar acceso al panel. Un profesional no decide
 * quién más entra.
 */
@ApiTags('staff')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@AdminOnly()
@Controller('staff/join-requests')
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
