import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class CreateTenantDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  businessType?: string;

  /**
   * Coordenadas del local. Nulables por separado para que un `null` explícito
   * pueda borrar la ubicación desde la configuración.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsLatitude()
  latitude?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLongitude()
  longitude?: number | null;

  @ApiProperty()
  @IsString()
  whatsappPhoneNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsappPhoneId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsappAccessToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsappBusinessId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsappWabaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsappVerifiedName?: string;

  @ApiPropertyOptional({
    description:
      'Id del Flow de reservas publicado en la WABA de este tenant. Con Flow se reserva por formulario; sin él, con listas y botones nativos.',
  })
  @IsOptional()
  @IsString()
  whatsappFlowId?: string;

  @ApiProperty()
  @IsString()
  timezone!: string;

  @ApiPropertyOptional({
    description: 'Moneda del negocio en ISO 4217: BOB, ARS, USD…',
    example: 'BOB',
  })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  googleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  googleRefreshToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  reminderOffsets?: number[];
}
