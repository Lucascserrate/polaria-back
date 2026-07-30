import { Module } from '@nestjs/common';

import { AssistantModule } from '../assistant/assistant.module';
import { BookingFlowModule } from '../booking-flow/booking-flow.module';
import { TenantsModule } from '../tenants/tenants.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { InboundMessageService } from './inbound-message.service';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

/**
 * Borde de entrada de WhatsApp: verificación, parseo y reparto de los mensajes
 * entre el flujo guiado de reservas y el asistente conversacional.
 */
@Module({
  imports: [TenantsModule, WhatsAppModule, BookingFlowModule, AssistantModule],
  controllers: [WebhookController],
  providers: [WebhookService, InboundMessageService],
})
export class WebhookModule {}
