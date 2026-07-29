import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingFlowEngine } from './booking-flow.engine';
import { WhatsappInteractiveAdapter } from './whatsapp-interactive.adapter';
import { Conversation } from '../conversations/entities/conversation.entity';
import { Service } from '../services/entities/service.entity';
import { Staff } from '../staff/entities/staff.entity';
import { BusinessHour } from '../business_hours/entities/business_hour.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { AppointmentService } from '../appointments/entities/appointment_service.entity';
import { Client } from '../clients/entities/client.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      Service,
      Staff,
      BusinessHour,
      Appointment,
      AppointmentService,
      Client,
    ]),
  ],
  providers: [BookingFlowEngine, WhatsappInteractiveAdapter],
  exports: [BookingFlowEngine, WhatsappInteractiveAdapter],
})
export class BookingFlowModule {}
