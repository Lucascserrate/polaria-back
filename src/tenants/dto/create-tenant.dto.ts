import { BusinessType } from '../entities/tenant.entity';

export class CreateTenantDto {
  name: string;
  businessType: BusinessType;
  whatsappPhoneNumber: string;
  whatsappPhoneId: string;
  timezone: string;
  googleRefreshToken: string;
}
