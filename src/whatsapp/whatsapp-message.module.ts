import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WhatsappInteractiveMessageModule } from './whatsapp-interactive-message.module';
import { WhatsappMessageSenderService } from './whatsapp-message-sender.service';

@Module({
  imports: [ConfigModule, WhatsappInteractiveMessageModule],
  providers: [WhatsappMessageSenderService],
  exports: [WhatsappMessageSenderService],
})
export class WhatsappMessageModule {}
