import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { BookingFlowModule } from '../booking-flow/booking-flow.module';
import { AssistantModule } from '../assistant/assistant.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { ProcessedWhatsappMessageEntity } from '../booking-flow/entities/processed-message.entity';
import { WhatsappMessageModule } from '../whatsapp/whatsapp-message.module';

@Module({
  imports: [
    BookingFlowModule,
    AssistantModule,
    TenantsModule,
    ConversationsModule,
    MessagesModule,
    WhatsappMessageModule,
    TypeOrmModule.forFeature([ProcessedWhatsappMessageEntity]),
  ],
  controllers: [WebhookController],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhookModule {}
