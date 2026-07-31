import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CompleteWhatsappEmbeddedSignupDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsOptional()
  @IsString()
  businessId?: string;

  @IsOptional()
  @IsString()
  wabaId?: string;

  @IsOptional()
  @IsString()
  phoneNumberId?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  systemUserAccessToken?: string;

  /**
   * `true` cuando Embedded Signup terminó con
   * `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`: el número queda compartido entre
   * la app de WhatsApp Business y Cloud API (Coexistence).
   */
  @IsOptional()
  @IsBoolean()
  coexistence?: boolean;
}
