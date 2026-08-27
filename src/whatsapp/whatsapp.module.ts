import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BookingPromptRenderer } from './booking-prompt.renderer';
import { Tenant } from '../tenants/entities/tenant.entity';
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
 * `TenantsModule` no entra, aunque sí la entidad `Tenant`: acá solo se leen las dos
 * columnas de credenciales para saber a quién le falta una plantilla, y depender del
 * módulo entero volvería a atar el transporte a la lógica de negocios.
 */
@Module({
  imports: [
    ConfigModule,
    /*
     * `Tenant` entra por el aprovisionamiento de negocios ya conectados, que
     * necesita saber a quién le falta una plantilla.
     *
     * Se registra la entidad y no se importa `TenantsModule`: lo único que hace
     * falta es leer dos columnas de credenciales, y depender del módulo entero
     * volvería a atar el transporte a la lógica de negocios que este cambio
     * justamente desató.
     */
    TypeOrmModule.forFeature([WhatsAppTemplate, Tenant]),
  ],
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
