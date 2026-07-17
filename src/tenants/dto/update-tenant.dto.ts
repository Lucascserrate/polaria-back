import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CreateTenantDto } from './create-tenant.dto';
import { AuthProvider } from '../../auth/domain/enums/auth.enum';

export class UpdateTenantDto extends PartialType(CreateTenantDto) {
  @IsOptional()
  @IsString()
  whatsappPhoneId?: string;

  @IsOptional()
  @IsString()
  whatsappPhoneNumber?: string;

  @IsOptional()
  @IsString()
  whatsappAccessToken?: string;

  @IsOptional()
  @IsString()
  whatsappBusinessId?: string;

  @IsOptional()
  @IsString()
  whatsappWabaId?: string;

  @IsOptional()
  @IsString()
  whatsappSystemUserAccessToken?: string;

  @IsOptional()
  @IsString()
  whatsappVerifiedName?: string;

  whatsappConnectedAt?: Date;

  @IsOptional()
  @IsString()
  provider?: AuthProvider;
}
