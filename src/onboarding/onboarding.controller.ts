import {
  Controller,
  Get,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { OnboardingService } from './onboarding.service';

@ApiTags('onboarding')
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  /**
   * Qué le falta configurar al negocio del token, y en qué estado está su
   * suscripción. Es lo que el panel usa para decidir a dónde mandar al usuario.
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('status')
  getStatus(@Req() req: Request) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }

    return this.onboardingService.getStatus(tenantId);
  }
}
