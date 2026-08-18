import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { ClientsModule } from '../clients/clients.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { BusinessHoursModule } from '../business_hours/business_hours.module';
import { ServicesModule } from '../services/services.module';
import { StaffModule } from '../staff/staff.module';
import { TenantsModule } from '../tenants/tenants.module';
import { AvailabilityModule } from '../availability/availability.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { AssistantAIService } from './services/assistant-ai.service';
import { AssistantContextService } from './services/assistant-context.service';
import { AssistantMessagingService } from './services/assistant-messaging.service';
import { AssistantPromptContextService } from './services/assistant-prompt-context.service';
import { AssistantIntentRouterService } from './services/assistant-intent-router.service';
import { AssistantSessionService } from './services/assistant-session.service';
import { AssistantReplyEnricherService } from './services/assistant-reply-enricher.service';

@Module({
  imports: [
    AIModule,
    ClientsModule,
    ConversationsModule,
    MessagesModule,
    BusinessHoursModule,
    ServicesModule,
    StaffModule,
    TenantsModule,
    AvailabilityModule,
    AppointmentsModule,
  ],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    AssistantPromptContextService,
    AssistantIntentRouterService,
    AssistantAIService,
    AssistantMessagingService,
    AssistantSessionService,
    AssistantContextService,
    AssistantReplyEnricherService,
  ],
  // `AssistantSessionService` se exporta porque el borde de entrada necesita
  // resolver cliente y conversación antes de decidir si el mensaje va al flujo
  // guiado o al asistente.
  exports: [AssistantService, AssistantSessionService],
})
export class AssistantModule {}
