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
import { AssistantAvailabilityService } from './services/assistant-availability.service';
import { AssistantPromptContextService } from './services/assistant-prompt-context.service';

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
    AssistantAvailabilityService,
  ],
})
export class AssistantModule {}
