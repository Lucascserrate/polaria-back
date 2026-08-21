import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Appointment } from '../appointments/entities/appointment.entity';
import { TenantsModule } from '../tenants/tenants.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AppointmentRemindersJob } from './appointment-reminders.job';
import { AppointmentRemindersRepository } from './appointment-reminders.repository';
import { AppointmentRemindersService } from './appointment-reminders.service';
import { AppointmentReminder } from './entities/appointment-reminder.entity';

/**
 * Recordatorios automáticos de citas.
 *
 * El nombre no menciona WhatsApp a propósito: el canal es un detalle de entrega
 * y vive en la columna `channel`. Lo que decide qué corresponde recordar no sabe
 * nada de plantillas ni de números de teléfono.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AppointmentReminder, Appointment]),
    TenantsModule,
    WhatsAppModule,
  ],
  providers: [
    AppointmentRemindersRepository,
    AppointmentRemindersService,
    AppointmentRemindersJob,
  ],
  exports: [AppointmentRemindersService],
})
export class RemindersModule {}
