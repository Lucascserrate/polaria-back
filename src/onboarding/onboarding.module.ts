import { Module } from '@nestjs/common';

import { BusinessHoursModule } from '../business_hours/business_hours.module';
import { ServicesModule } from '../services/services.module';
import { StaffModule } from '../staff/staff.module';
import { TenantsModule } from '../tenants/tenants.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

/**
 * Estado de configuración del negocio.
 *
 * Solo lee: reúne los conteos de los módulos que ya existen y deriva el estado.
 * No tiene entidades propias porque no hay nada nuevo que persistir — que es
 * justamente lo que evita que el estado se desincronice.
 */
@Module({
  imports: [TenantsModule, BusinessHoursModule, ServicesModule, StaffModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
