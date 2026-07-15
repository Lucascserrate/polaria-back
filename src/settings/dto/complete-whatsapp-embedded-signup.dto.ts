import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
}
