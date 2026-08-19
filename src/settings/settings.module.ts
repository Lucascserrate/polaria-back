import { Module } from '@nestjs/common';
import { BookingFlowModule } from '../booking-flow/booking-flow.module';
import { BusinessHoursModule } from '../business_hours/business_hours.module';
import { TenantsModule } from '../tenants/tenants.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  // `BookingFlowModule` entra por la desconexión: cerrar las reservas en curso
  // es parte de soltar la conexión de WhatsApp.
  imports: [TenantsModule, BusinessHoursModule, BookingFlowModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
