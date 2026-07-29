import { Module } from '@nestjs/common';
import { WhatsappInteractiveMessageService } from './whatsapp-interactive-message.service';

@Module({
  providers: [WhatsappInteractiveMessageService],
  exports: [WhatsappInteractiveMessageService],
})
export class WhatsappInteractiveMessageModule {}
