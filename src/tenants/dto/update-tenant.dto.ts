import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CreateTenantDto } from './create-tenant.dto';

export class UpdateTenantDto extends PartialType(CreateTenantDto) {
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
}
