import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { CreateTenantDto } from './create-tenant.dto';

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  whatsappConnectedAt?: string;
}
