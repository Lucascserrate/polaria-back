import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Service } from '../services/entities/service.entity';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AppointmentNotification } from './entities/appointment-notification.entity';
import { StaffNotificationsJob } from './staff-notifications.job';
import { StaffNotificationsRepository } from './staff-notifications.repository';
import { StaffNotificationsService } from './staff-notifications.service';

/**
 * Avisos a los profesionales de que una cita suya cambió.
 *
 * Módulo propio y no parte de `appointments` porque la dependencia va en el
 * sentido contrario al que parecería: las citas encolan avisos, y los avisos
 * necesitan WhatsApp. Metiéndolo en `appointments` ese módulo pasaría a depender del
 * transporte, y el ciclo con `whatsapp` —que ya depende de citas por el flujo de
 * reserva— sería cuestión de tiempo.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AppointmentNotification, Service]),
    WhatsAppModule,
  ],
  providers: [
    StaffNotificationsRepository,
    StaffNotificationsService,
    StaffNotificationsJob,
  ],
  exports: [StaffNotificationsService, StaffNotificationsJob],
})
export class NotificationsModule {}
