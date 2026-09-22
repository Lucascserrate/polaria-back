import { Injectable, NotFoundException } from '@nestjs/common';

import { AppointmentsService } from '../appointments/appointments.service';
import { BusinessHoursService } from '../business_hours/business_hours.service';
import { ServicesService } from '../services/services.service';
import { StaffService } from '../staff/staff.service';
import { isBookableStaff } from '../staff/staff-role';
import { TenantsService } from '../tenants/tenants.service';
import { readStoredCredential } from '../whatsapp/utils/stored-credential.util';
import {
  resolveSubscription,
  type ResolvedSubscription,
} from '../subscriptions/subscription.rules';
import {
  resolveOnboardingStatus,
  type OnboardingStatus,
} from './onboarding.rules';

export type OnboardingResponse = OnboardingStatus & {
  subscription: ResolvedSubscription;
};

/**
 * Reúne lo que hace falta para saber qué le falta configurar a un negocio.
 *
 * No guarda nada: cuenta lo que existe y le pregunta a las reglas puras. Por eso
 * el estado no puede quedar desactualizado, y por eso este servicio no tiene una
 * sola decisión adentro.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly businessHoursService: BusinessHoursService,
    private readonly servicesService: ServicesService,
    private readonly staffService: StaffService,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  async getStatus(tenantId: string): Promise<OnboardingResponse> {
    const tenant = await this.tenantsService.findOne(tenantId);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const [businessHours, services, staff, completedAppointments] =
      await Promise.all([
        this.businessHoursService.getTenantSchedule(tenantId),
        this.servicesService.findActiveByTenant(tenantId),
        this.staffService.findByTenant(tenantId),
        this.appointmentsService.countCompletedByTenant(tenantId),
      ]);

    /*
     * La conexión se mide por credenciales, igual que en `/settings`: son las que
     * el webhook usa para responder. Ya no es un paso del onboarding —viaja suelta,
     * como sugerencia—, pero se sigue midiendo acá para no preguntarle al panel que
     * lo deduzca de otra pantalla.
     */
    const whatsappConnected = Boolean(
      readStoredCredential(tenant.whatsappAccessToken) &&
      readStoredCredential(tenant.whatsappPhoneId),
    );

    const status = resolveOnboardingStatus({
      hasName: Boolean(tenant.name?.trim()),
      hasBusinessType: Boolean(tenant.businessType?.trim()),
      businessHoursCount: businessHours.length,
      activeServicesCount: services.length,
      /*
       * Un administrativo no cuenta para este paso. Si contara, cargar a quien
       * lleva la caja marcaría "Personal" como resuelto y el negocio quedaría
       * creyendo que está listo mientras la reserva no ofrece a nadie.
       */
      bookableStaffCount: staff.filter(
        (member) =>
          isBookableStaff(member) && (member.services?.length ?? 0) > 0,
      ).length,
      completedAppointmentsCount: completedAppointments,
      whatsappConnected,
    });

    return {
      ...status,
      subscription: resolveSubscription(
        {
          subscriptionStatus: tenant.subscriptionStatus,
          trialEndsAt: tenant.trialEndsAt ?? null,
          subscriptionEndsAt: tenant.subscriptionEndsAt ?? null,
        },
        new Date(),
      ),
    };
  }
}
