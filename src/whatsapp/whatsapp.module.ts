import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { TenantsModule } from '../tenants/tenants.module';

import { BookingPromptRenderer } from './booking-prompt.renderer';
import { WhatsAppSenderService } from './whatsapp-sender.service';
import { ReminderTemplateStatusJob } from './reminder-template-status.job';
import { WhatsAppTemplateService } from './whatsapp-template.service';

/**
 * Capa de transporte de WhatsApp: parseo de mensajes entrantes y envío de
 * texto, botones, listas y plantillas, y el aprovisionamiento de estas últimas
 * en la WABA de cada negocio. No contiene lógica de negocio.
 */
@Module({
  // `TenantsModule` entra por el barrido de plantillas pendientes, que necesita
  // saber qué negocios están esperando aprobación.
  imports: [ConfigModule, TenantsModule],
  providers: [
    WhatsAppSenderService,
    WhatsAppTemplateService,
    BookingPromptRenderer,
    ReminderTemplateStatusJob,
  ],
  exports: [
    WhatsAppSenderService,
    WhatsAppTemplateService,
    BookingPromptRenderer,
  ],
})
export class WhatsAppModule {}
