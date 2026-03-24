import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AIModule } from '../ai/ai.module';
import { Client } from '../clients/entities/client.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { Message } from '../messages/entities/message.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { BusinessHour } from '../business_hours/entities/business_hour.entity';
import { ConversationEngineController } from './conversation_engine.controller';
import { ConversationEngineService } from './conversation_engine.service';
import { ConversationIdentityService } from './services/conversation_identity.service';
import { ConversationMessagesService } from './services/conversation_messages.service';
import { ConversationTenantService } from './services/conversation_tenant.service';
import { ConversationStateService } from './services/conversation_state.service';
import { ConversationAvailabilityService } from './services/conversation_availability.service';
import { ConversationAIFlowService } from './services/conversation_ai_flow.service';
import { ConversationAppointmentService } from './services/conversation_appointment.service';
import { Staff } from '../staff/entities/staff.entity';
import { ConversationBookingService } from './services/conversation_booking.service';
import { Service } from '../services/entities/service.entity';

@Module({
  imports: [
    AIModule,
    TypeOrmModule.forFeature([
      Message,
      Client,
      Conversation,
      Tenant,
      Service,
      Appointment,
      BusinessHour,
      Staff,
    ]),
  ],
  controllers: [ConversationEngineController],
  providers: [
    ConversationEngineService,
    ConversationIdentityService,
    ConversationMessagesService,
    ConversationTenantService,
    ConversationStateService,
    ConversationAvailabilityService,
    ConversationAIFlowService,
    ConversationAppointmentService,
    ConversationBookingService,
  ],
})
export class ConversationEngineModule {}
