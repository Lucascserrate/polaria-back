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
import { AdminOnly, Roles, RolesGuard } from '../auth/guards/roles.guard';
import { NoImpersonationGuard } from '../auth/guards/no-impersonation.guard';
import { Actor, type AuthenticatedActor } from '../auth/actor';
import { STAFF_ACCESS_ROLES } from '../staff/staff-role';
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

  /**
   * El marco del negocio: zona horaria, moneda y horario.
   *
   * Abierto a cualquier rol, y es la única excepción al `@AdminOnly` de la clase.
   * No es una concesión: sin la zona horaria no se puede saber qué día es hoy, y sin
   * el horario no se puede sombrear lo que está abierto. La agenda de un profesional
   * necesita las dos cosas para dibujarse, y ninguna es un dato de administración.
   *
   * Lo que **no** viaja acá es lo de la conexión con Meta —ids de la WABA y del
   * número— que sí lo es. Ver `getBusinessContext`.
   */
  @Get('context')
  @Roles(...STAFF_ACCESS_ROLES)
  getBusinessContext(@Actor() actor: AuthenticatedActor) {
    return this.settingsService.getBusinessContext(actor.tenantId);
  }

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

  @UseGuards(AuthGuard('jwt'), NoImpersonationGuard)
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
  /**
   * Vuelve a preguntarle a Meta por la facturación de la WABA.
   *
   * Lo toca el negocio después de configurar en el Billing Hub: sin esto, la pantalla
   * seguiría diciendo "pendiente" hasta que fallara otro envío.
   */
  @UseGuards(AuthGuard('jwt'))
  @Post('whatsapp/billing/check')
  refreshWhatsappBilling(@Actor() actor: AuthenticatedActor) {
    return this.settingsService.refreshWhatsappBilling(actor.tenantId);
  }

  @UseGuards(AuthGuard('jwt'), NoImpersonationGuard)
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
