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
  MaxLength,
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
   * Dirección del local en texto, para la página pública de reservas. `null` la
   * borra. No confundir con las coordenadas de abajo: aquélla ubica en un mapa,
   * ésta es la que se lee.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string | null;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsappPhoneNumber?: string | null;

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

  /**
   * Los avisos automáticos por WhatsApp.
   *
   * Distinto de `aiEnabled`, que es el bot que **responde** a los clientes. Esto son
   * los mensajes que Polaria **inicia**: al equipo cuando cambia una cita, y a los
   * clientes como recordatorio.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  whatsappNotificationsEnabled?: boolean;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  reminderOffsets?: number[];
}
