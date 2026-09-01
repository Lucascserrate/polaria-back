import {
  Body,
  Controller,
  Logger,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { SettingsService } from '../settings/settings.service';
import { CompleteWhatsappEmbeddedSignupDto } from '../settings/dto/complete-whatsapp-embedded-signup.dto';

/**
 * Conectar y desconectar WhatsApp **en nombre de otro negocio**.
 *
 * Existe porque las rutas de `/settings` sacan el tenant del JWT, que es lo
 * correcto para el dueño y lo inservible para soporte: correr el Embedded Signup
 * desde el panel interno guardaría las credenciales en el negocio de quien está
 * dando soporte, no en el que tiene el problema. Acá el tenant viaja en la URL.
 *
 * Es la misma operación —`SettingsService` ya recibía el tenant por parámetro—,
 * lo único distinto es de dónde sale ese id y quién puede pedirla. Por eso no se
 * duplicó nada del intercambio con Meta: un segundo camino que escribe
 * credenciales es un segundo camino que puede quedar desactualizado.
 *
 * Vive en su propia carpeta y no en `settings/` porque estas rutas se van con el
 * repositorio de administración cuando se separe.
 */
@ApiTags('support')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), SuperAdminGuard)
@Controller('support/tenants/:tenantId/whatsapp')
export class SupportWhatsappController {
  private readonly logger = new Logger(SupportWhatsappController.name);

  constructor(private readonly settingsService: SettingsService) {}

  @Patch('embedded-signup')
  completeEmbeddedSignup(
    @Param('tenantId') tenantId: string,
    @Body() body: CompleteWhatsappEmbeddedSignupDto,
  ) {
    this.logger.log(`Embedded signup desde soporte (tenantId=${tenantId}).`);

    return this.settingsService.completeWhatsappEmbeddedSignup(tenantId, {
      code: body.code,
      businessId: body.businessId,
      wabaId: body.wabaId,
      phoneNumberId: body.phoneNumberId,
      phoneNumber: body.phoneNumber,
      systemUserAccessToken: body.systemUserAccessToken,
      coexistence: body.coexistence,
    });
  }

  @Post('disconnect')
  disconnect(@Param('tenantId') tenantId: string) {
    this.logger.log(`Desconexión desde soporte (tenantId=${tenantId}).`);
    return this.settingsService.disconnectWhatsapp(tenantId);
  }
}
