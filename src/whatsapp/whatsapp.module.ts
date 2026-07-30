import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { BookingPromptRenderer } from './booking-prompt.renderer';
import { WhatsAppSenderService } from './whatsapp-sender.service';

/**
 * Capa de transporte de WhatsApp: parseo de mensajes entrantes y envío de
 * texto, botones y listas. No contiene lógica de negocio.
 */
@Module({
  imports: [ConfigModule],
  providers: [WhatsAppSenderService, BookingPromptRenderer],
  exports: [WhatsAppSenderService, BookingPromptRenderer],
})
export class WhatsAppModule {}
