import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { SettingsModule } from '../settings/settings.module';
import { TenantsModule } from '../tenants/tenants.module';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { SupportWhatsappController } from './support-whatsapp.controller';
import { SupportImpersonationController } from './support-impersonation.controller';
import { SupportTrialController } from './support-trial.controller';

/**
 * Las rutas internas de soporte que operan sobre un tenant ajeno.
 *
 * Importa `SettingsModule` y no al revés: la dependencia va de la herramienta
 * interna hacia el producto, nunca de vuelta. Es lo que permite borrar esta
 * carpeta entera el día que la administración se mude a su propio repositorio.
 */
@Module({
  imports: [ConfigModule, SettingsModule, TenantsModule],
  controllers: [
    SupportWhatsappController,
    SupportImpersonationController,
    SupportTrialController,
  ],
  providers: [SuperAdminGuard],
})
export class SupportModule {}
