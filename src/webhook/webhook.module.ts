import { Module } from '@nestjs/common';

import { AppointmentsModule } from '../appointments/appointments.module';
import { AssistantModule } from '../assistant/assistant.module';
import { BookingFlowModule } from '../booking-flow/booking-flow.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { TenantsModule } from '../tenants/tenants.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AccountUpdateService } from './account-update.service';
import { ConversationRecorderService } from './conversation-recorder.service';
import { InboundMessageService } from './inbound-message.service';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

/**
 * Borde de entrada de WhatsApp: verificación, parseo y reparto de los mensajes
 * entre el flujo guiado de reservas y el asistente conversacional.
 */
@Module({
  imports: [
    TenantsModule,
    WhatsAppModule,
    BookingFlowModule,
    AssistantModule,
    MessagesModule,
    ConversationsModule,
    AppointmentsModule,
  ],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    AccountUpdateService,
    InboundMessageService,
    ConversationRecorderService,
  ],
})
export class WebhookModule {}
