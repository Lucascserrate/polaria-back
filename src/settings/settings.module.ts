import { Module } from '@nestjs/common';
import { BusinessHoursModule } from '../business_hours/business_hours.module';
import { TenantsModule } from '../tenants/tenants.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [TenantsModule, BusinessHoursModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
