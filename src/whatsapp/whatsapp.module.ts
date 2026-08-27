import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BookingPromptRenderer } from './booking-prompt.renderer';
import { WhatsAppTemplate } from './entities/whatsapp-template.entity';
import { TemplateStatusJob } from './template-status.job';
import { WhatsAppSenderService } from './whatsapp-sender.service';
import { WhatsAppTemplateService } from './whatsapp-template.service';
import { WhatsAppTemplatesRepository } from './whatsapp-templates.repository';

/**
 * Capa de transporte de WhatsApp: parseo de mensajes entrantes y envío de texto,
 * botones, listas y plantillas, y el aprovisionamiento de estas últimas en la WABA
 * de cada negocio. No contiene lógica de negocio.
 *
 * `TenantsModule` ya no entra: el barrido de aprobaciones consultaba negocios
 * cuando el estado de la plantilla vivía en `tenants`. Ahora consulta
 * `whatsapp_templates` y trae el negocio por la relación, así que la dependencia
 * se fue con las columnas.
 */
@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([WhatsAppTemplate])],
  providers: [
    WhatsAppSenderService,
    WhatsAppTemplateService,
    WhatsAppTemplatesRepository,
    BookingPromptRenderer,
    TemplateStatusJob,
  ],
  exports: [
    WhatsAppSenderService,
    WhatsAppTemplateService,
    WhatsAppTemplatesRepository,
    BookingPromptRenderer,
  ],
})
export class WhatsAppModule {}
