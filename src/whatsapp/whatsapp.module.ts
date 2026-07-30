import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { WhatsAppSenderService } from './whatsapp-sender.service';

/**
 * Capa de transporte de WhatsApp: parseo de mensajes entrantes y envío de
 * texto, botones y listas. No contiene lógica de negocio.
 */
@Module({
  imports: [ConfigModule],
  providers: [WhatsAppSenderService],
  exports: [WhatsAppSenderService],
})
export class WhatsAppModule {}
