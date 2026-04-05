import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { ClientsModule } from '../clients/clients.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { BusinessHoursModule } from '../business_hours/business_hours.module';
import { ServicesModule } from '../services/services.module';
import { StaffModule } from '../staff/staff.module';
import { TenantsModule } from '../tenants/tenants.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
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
  ],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantPromptContextService],
})
export class AssistantModule {}
