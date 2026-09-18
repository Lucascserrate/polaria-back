import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

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
