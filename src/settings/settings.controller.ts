import {
  Body,
  Controller,
  Get,
  Logger,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminOnly, RolesGuard } from '../auth/guards/roles.guard';
import type { Request } from 'express';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { CompleteWhatsappEmbeddedSignupDto } from './dto/complete-whatsapp-embedded-signup.dto';

@ApiTags('settings')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@AdminOnly()
@Controller('settings')
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(private readonly settingsService: SettingsService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get()
  getSettings(@Req() req: Request) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.settingsService.getSettings(tenantId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch()
  updateSettings(
    @Req() req: Request,
    @Body() updateSettingsDto: UpdateSettingsDto,
  ) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.settingsService.updateSettings(tenantId, updateSettingsDto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('whatsapp/embedded-signup')
  completeWhatsappEmbeddedSignup(
    @Req() req: Request,
    @Body() body: CompleteWhatsappEmbeddedSignupDto,
  ) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }

    this.logger.log(
      `Embedded signup authorization code received tenantId=${tenantId}`,
    );

    return this.settingsService
      .completeWhatsappEmbeddedSignup(tenantId, {
        code: body.code,
        businessId: body.businessId,
        wabaId: body.wabaId,
        phoneNumberId: body.phoneNumberId,
        phoneNumber: body.phoneNumber,
        systemUserAccessToken: body.systemUserAccessToken,
        coexistence: body.coexistence,
      })
      .then((result) => {
        this.logger.log(`Embedded signup completed tenantId=${tenantId}`);
        return result;
      })
      .catch((error) => {
        this.logger.error(
          `Embedded signup failed tenantId=${tenantId} message=${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
        throw error;
      });
  }

  /**
   * Suelta la conexión de WhatsApp del lado de Polaria.
   *
   * No hace ninguna llamada a Meta: el número, la WABA y el portfolio quedan
   * intactos, y el negocio puede volver a conectarlos con Embedded Signup.
   */
  @UseGuards(AuthGuard('jwt'))
  @Post('whatsapp/disconnect')
  disconnectWhatsapp(@Req() req: Request) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }

    this.logger.log(`WhatsApp disconnect requested tenantId=${tenantId}`);
    return this.settingsService.disconnectWhatsapp(tenantId);
  }
}
