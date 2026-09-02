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
  whatsappVerifiedName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  whatsappConnectedAt?: string;

  /**
   * Saludo propio del negocio. `null` lo devuelve al de fábrica.
   *
   * Nulable de forma explícita y no opcional a secas: TypeORM ignora las
   * propiedades `undefined` al guardar, así que sin el `| null` no habría forma
   * de borrarlo y "volver al texto original" quedaría sin implementar.
   */
  @IsOptional()
  @IsString()
  welcomeMessage?: string | null;
}
